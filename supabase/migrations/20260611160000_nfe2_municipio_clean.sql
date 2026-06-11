-- =============================================================
-- FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1 · NFe-2 A4
-- =============================================================
-- Ajuste em fn_pedido_nfe_dados: 'municipio' do destinatario sai
-- sem o sufixo " (UF)" que vinha de erp_clientes.cidade
-- (regexp_replace remove "\s*\(.*\)$" no fim).
--
-- Migration aplicada via MCP em 2026-06-11.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_pedido_nfe_dados(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ped record; v_cli record; v_doc text; v_tipo text;
  v_itens jsonb; v_total numeric(14,2); v_nfe record;
BEGIN
  SELECT id,numero,status,company_id,cliente_id,cliente_nome,cliente_cnpj,cliente_email
    INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro','Pedido nao encontrado'); END IF;

  v_doc := regexp_replace(COALESCE(v_ped.cliente_cnpj,''),'[^0-9]','','g');
  v_tipo := CASE WHEN length(v_doc)=11 THEN 'cpf' WHEN length(v_doc)=14 THEN 'cnpj' ELSE 'indefinido' END;

  SELECT logradouro,numero,bairro,cidade,uf,cep INTO v_cli
  FROM erp_clientes WHERE id = v_ped.cliente_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'produto_id', i.produto_id, 'codigo', p.codigo,
            'descricao', COALESCE(i.produto_nome, p.nome),
            'ncm', replace(COALESCE(p.ncm,''),'.',''),
            'cest', NULLIF(p.cest,''),
            'csosn', p.cst_icms, 'cfop', p.cfop_venda,
            'origem', COALESCE(p.origem,'0'),
            'unidade', COALESCE(i.unidade, p.unidade,'UN'),
            'quantidade', i.quantidade, 'valor_unitario', i.preco_unitario,
            'subtotal', i.subtotal,
            'cst_pis', COALESCE(p.cst_pis,'49'), 'cst_cofins', COALESCE(p.cst_cofins,'49')
         ) ORDER BY i.subtotal DESC), '[]'::jsonb), COALESCE(SUM(i.subtotal),0)
    INTO v_itens, v_total
  FROM erp_pedidos_itens i
  LEFT JOIN erp_produtos p ON p.id = i.produto_id
  WHERE i.pedido_id = p_pedido_id AND i.tipo_item='produto';

  SELECT id,numero,status,danfe_url INTO v_nfe
  FROM erp_nfe_emitidas
  WHERE pedido_id = p_pedido_id AND status NOT IN ('rejeitada','cancelada','erro')
  ORDER BY criado_em DESC LIMIT 1;

  RETURN jsonb_build_object(
    'pedido_id', v_ped.id, 'pedido_numero', v_ped.numero, 'status', v_ped.status,
    'tem_produto', (v_total > 0), 'valor_produtos', v_total,
    'destinatario', jsonb_build_object(
        'documento', v_doc, 'tipo', v_tipo, 'nome', v_ped.cliente_nome, 'email', v_ped.cliente_email,
        'logradouro', v_cli.logradouro, 'numero', v_cli.numero, 'bairro', v_cli.bairro,
        'municipio', trim(regexp_replace(COALESCE(v_cli.cidade,''),'\s*\(.*\)$','')),
        'uf', v_cli.uf,
        'cep', regexp_replace(COALESCE(v_cli.cep,''),'[^0-9]','','g')),
    'itens', v_itens,
    'ja_emitida', (v_nfe.id IS NOT NULL),
    'nfe_existente', CASE WHEN v_nfe.id IS NOT NULL THEN jsonb_build_object(
        'id',v_nfe.id,'numero',v_nfe.numero,'status',v_nfe.status,'danfe_url',v_nfe.danfe_url) ELSE NULL END
  );
END; $$;
