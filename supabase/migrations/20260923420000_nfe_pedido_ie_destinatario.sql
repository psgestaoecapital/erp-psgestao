-- #125 (CRÍTICO) — NF-e do pedido rejeitada pela Sefaz 232 "IE do destinatário não informada".
-- Causa: fn_pedido_nfe_dados lia do erp_clientes só o endereço — NUNCA a IE nem o contribuinte_icms —
-- e o destinatário devolvido não trazia inscricao_estadual/indicador_ie. O provider (Focus) já sabe
-- enviar a IE quando indIEDest=1, mas nunca a recebia. Ex.: CIDIMAR (37919436000199, ie 260607100,
-- contribuinte, SC) — dado correto no cadastro, mas a emissão não lia. KGF não conseguia faturar.
--
-- Fix: a RPC passa a ler ie + contribuinte_icms e devolver:
--   inscricao_estadual = dígitos da IE (NULL se vazia);
--   indicador_ie = 1 contribuinte / 2 isento / 9 não contribuinte; NULL no cadastro → o provider deriva
--                  de ter IE (ie ? 1 : 9), preservando o comportamento dos clientes sem esse campo.
-- O builder (nfe-builder.ts) mapeia esses dois campos para o destinatário. Casa o cliente por id
-- (não pela coluna de CNPJ), então não havia troca cnpj_cpf×cpf_cnpj — era ausência total da IE.
--
-- Provado em rollback: pedido PED-ORC-2026-0004 (CIDIMAR) → destinatario.inscricao_estadual=260607100,
-- indicador_ie=1. RD-52 (arquivo=ledger). SECURITY DEFINER (read-only) → REVOKE anon + GRANT.

CREATE OR REPLACE FUNCTION public.fn_pedido_nfe_dados(p_pedido_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ped record; v_cli record; v_doc text; v_tipo text;
  v_itens jsonb; v_total numeric(14,2); v_nfe record; v_ind int;
BEGIN
  SELECT id,numero,status,company_id,cliente_id,cliente_nome,cliente_cnpj,cliente_email
    INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro','Pedido nao encontrado'); END IF;

  v_doc := regexp_replace(COALESCE(v_ped.cliente_cnpj,''),'[^0-9]','','g');
  v_tipo := CASE WHEN length(v_doc)=11 THEN 'cpf' WHEN length(v_doc)=14 THEN 'cnpj' ELSE 'indefinido' END;

  -- #125: lê IE + contribuinte_icms do cadastro do cliente (antes só endereço).
  SELECT logradouro,numero,bairro,cidade,uf,cep,ie,contribuinte_icms INTO v_cli
  FROM erp_clientes WHERE id = v_ped.cliente_id;

  v_ind := CASE lower(COALESCE(v_cli.contribuinte_icms,''))
             WHEN 'contribuinte' THEN 1 WHEN 'isento' THEN 2 WHEN 'nao_contribuinte' THEN 9 ELSE NULL END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'produto_id', i.produto_id, 'codigo', p.codigo,
            'descricao', COALESCE(i.produto_nome, p.nome),
            'ncm', replace(COALESCE(p.ncm,''),'.',''), 'cest', NULLIF(p.cest,''),
            'csosn', p.cst_icms, 'cfop', p.cfop_venda, 'origem', COALESCE(p.origem,'0'),
            'unidade', COALESCE(i.unidade, p.unidade,'UN'),
            'quantidade', i.quantidade, 'valor_unitario', i.preco_unitario, 'subtotal', i.subtotal,
            'cst_pis', COALESCE(p.cst_pis,'49'), 'cst_cofins', COALESCE(p.cst_cofins,'49')
         ) ORDER BY i.subtotal DESC), '[]'::jsonb), COALESCE(SUM(i.subtotal),0)
    INTO v_itens, v_total
  FROM erp_pedidos_itens i LEFT JOIN erp_produtos p ON p.id = i.produto_id
  WHERE i.pedido_id = p_pedido_id AND i.tipo_item='produto';

  SELECT id,numero,status,danfe_url INTO v_nfe FROM erp_nfe_emitidas
  WHERE pedido_id = p_pedido_id AND status NOT IN ('rejeitada','cancelada','erro')
  ORDER BY criado_em DESC LIMIT 1;

  RETURN jsonb_build_object(
    'pedido_id', v_ped.id, 'pedido_numero', v_ped.numero, 'status', v_ped.status,
    'tem_produto', (v_total > 0), 'valor_produtos', v_total,
    'destinatario', jsonb_build_object(
        'documento', v_doc, 'tipo', v_tipo, 'nome', v_ped.cliente_nome, 'email', v_ped.cliente_email,
        'inscricao_estadual', NULLIF(regexp_replace(COALESCE(v_cli.ie,''),'[^0-9]','','g'),''),
        'indicador_ie', v_ind,
        'logradouro', v_cli.logradouro, 'numero', v_cli.numero, 'bairro', v_cli.bairro,
        'municipio', trim(regexp_replace(COALESCE(v_cli.cidade,''),'\s*\(.*\)$','')),
        'uf', v_cli.uf, 'cep', regexp_replace(COALESCE(v_cli.cep,''),'[^0-9]','','g')),
    'itens', v_itens, 'ja_emitida', (v_nfe.id IS NOT NULL),
    'nfe_existente', CASE WHEN v_nfe.id IS NOT NULL THEN jsonb_build_object('id',v_nfe.id,'numero',v_nfe.numero,'status',v_nfe.status,'danfe_url',v_nfe.danfe_url) ELSE NULL END
  );
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pedido_nfe_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_nfe_dados(uuid) TO authenticated, service_role;
