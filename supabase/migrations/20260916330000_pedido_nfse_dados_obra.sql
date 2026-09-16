-- #82② cluster obra · Parte 2 — a emissão passa a LER a obra do pedido.
-- fn_pedido_nfse_dados hoje NÃO retorna bloco de obra nenhum — por isso o E0370 falhava sem dado.
-- Agora ela expõe: exige_obra (algum serviço é E0370, mesma regra da emissão) + o bloco 'obra' (campos
-- congelados no pedido, autossuficiência fiscal) + obra_pendente (exige mas falta CNO e endereço/IBGE).
-- Aditivo ao retorno JSON — nenhum consumidor existente quebra (só ganha campos novos). RD-53.

CREATE OR REPLACE FUNCTION public.fn_pedido_nfse_dados(p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido   record;
  v_doc      text;
  v_tipo_doc text;
  v_servicos jsonb;
  v_total    numeric(14,2);
  v_nfse     record;
  v_exige_obra boolean;
  v_obra_pendente boolean;
BEGIN
  SELECT id, numero, status, company_id, cliente_id,
         cliente_nome, cliente_cnpj, cliente_email,
         obra_id, obra_cno, obra_logradouro, obra_numero, obra_complemento,
         obra_bairro, obra_cidade, obra_uf, obra_cep, obra_codigo_ibge
    INTO v_pedido
  FROM erp_pedidos
  WHERE id = p_pedido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Pedido nao encontrado');
  END IF;

  v_doc := regexp_replace(COALESCE(v_pedido.cliente_cnpj,''), '[^0-9]', '', 'g');
  v_tipo_doc := CASE WHEN length(v_doc) = 11 THEN 'cpf'
                     WHEN length(v_doc) = 14 THEN 'cnpj'
                     ELSE 'indefinido' END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'servico_id',               i.servico_id,
            'descricao',                COALESCE(i.servico_descricao, s.descricao_resumida),
            'codigo_servico_municipio', s.codigo_servico_municipio,
            'codigo_lc116',             s.codigo_lc116,
            'aliquota_iss',             COALESCE(s.aliquota_iss, 0),
            'iss_retido',               COALESCE(s.iss_retido, false),
            'cnae',                     s.cnae,
            'valor',                    i.subtotal
         ) ORDER BY i.subtotal DESC), '[]'::jsonb),
         COALESCE(SUM(i.subtotal), 0)
    INTO v_servicos, v_total
  FROM erp_pedidos_itens i
  LEFT JOIN erp_servicos s ON s.id = i.servico_id
  WHERE i.pedido_id = p_pedido_id
    AND i.tipo_item = 'servico';

  -- Exige obra? MESMA regra da emissão (fn_fiscal_exige_obra pelo codigo_servico_municipio).
  SELECT COALESCE(bool_or(fn_fiscal_exige_obra(v_pedido.company_id, s.codigo_servico_municipio)), false)
    INTO v_exige_obra
  FROM erp_pedidos_itens i
  JOIN erp_servicos s ON s.id = i.servico_id
  WHERE i.pedido_id = p_pedido_id AND i.tipo_item = 'servico' AND i.servico_id IS NOT NULL;

  -- Pendente = exige obra mas não tem CNO NEM (endereço + IBGE). IBGE nulo nunca é chutado — sinaliza aqui.
  v_obra_pendente := v_exige_obra AND
      COALESCE(NULLIF(TRIM(v_pedido.obra_cno),''),'') = '' AND
      (COALESCE(NULLIF(TRIM(v_pedido.obra_logradouro),''),'') = '' OR COALESCE(NULLIF(TRIM(v_pedido.obra_codigo_ibge),''),'') = '');

  SELECT id, numero, status, pdf_url
    INTO v_nfse
  FROM erp_nfse_emitidas
  WHERE pedido_id = p_pedido_id
    AND status NOT IN ('rejeitada','cancelada','erro')
  ORDER BY criado_em DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'pedido_id',      v_pedido.id,
    'pedido_numero',  v_pedido.numero,
    'status',         v_pedido.status,
    'tem_servico',    (v_total > 0),
    'valor_servicos', v_total,
    'tomador', jsonb_build_object(
        'documento', v_doc,
        'tipo',      v_tipo_doc,
        'nome',      v_pedido.cliente_nome,
        'email',     v_pedido.cliente_email
    ),
    'servicos',       v_servicos,
    'exige_obra',     v_exige_obra,
    'obra_pendente',  v_obra_pendente,
    'obra', CASE WHEN v_pedido.obra_id IS NOT NULL OR v_pedido.obra_cno IS NOT NULL OR v_pedido.obra_logradouro IS NOT NULL THEN jsonb_build_object(
        'obra_id',       v_pedido.obra_id,
        'cno',           v_pedido.obra_cno,
        'logradouro',    v_pedido.obra_logradouro,
        'numero',        v_pedido.obra_numero,
        'complemento',   v_pedido.obra_complemento,
        'bairro',        v_pedido.obra_bairro,
        'cidade',        v_pedido.obra_cidade,
        'uf',            v_pedido.obra_uf,
        'cep',           v_pedido.obra_cep,
        'codigo_ibge',   v_pedido.obra_codigo_ibge
    ) ELSE NULL END,
    'ja_emitida',     (v_nfse.id IS NOT NULL),
    'nfse_existente', CASE WHEN v_nfse.id IS NOT NULL THEN jsonb_build_object(
        'id',      v_nfse.id,
        'numero',  v_nfse.numero,
        'status',  v_nfse.status,
        'pdf_url', v_nfse.pdf_url
    ) ELSE NULL END
  );
END;
$function$;
