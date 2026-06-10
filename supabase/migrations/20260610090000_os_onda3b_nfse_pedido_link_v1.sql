-- =============================================================
-- FEAT-OS-ONDA3B-NFSE-PEDIDO-LINK-v1 · Onda 3b da trilha OS
-- =============================================================
-- NFS-e no faturamento (modo A: preparar + emitir 1 clique).
-- A edge gov-nfse-emitir continua INTOCADA · so vinculo + 2 RPCs.
--
-- - ADD COLUMN erp_nfse_emitidas.pedido_id (rastreabilidade + anti-duplicata)
-- - fn_pedido_nfse_dados(pedido_id): read-only · jsonb com dados prontos pra
--   emitir a NFS-e (tomador, lista de servicos, valor, tem_servico, ja_emitida,
--   nfse_existente)
-- - fn_pedido_nfse_marcar_emitida(pedido_id, provider_reference): apos
--   autorizacao, vincula a NFS-e ao pedido
--
-- Migration aplicada via MCP em 2026-06-10.
-- =============================================================

ALTER TABLE erp_nfse_emitidas
  ADD COLUMN IF NOT EXISTS pedido_id uuid;

CREATE INDEX IF NOT EXISTS idx_nfse_emitidas_pedido
  ON erp_nfse_emitidas (pedido_id) WHERE pedido_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_pedido_nfse_dados(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido   record;
  v_doc      text;
  v_tipo_doc text;
  v_servicos jsonb;
  v_total    numeric(14,2);
  v_nfse     record;
BEGIN
  SELECT id, numero, status, company_id, cliente_id,
         cliente_nome, cliente_cnpj, cliente_email
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
    'ja_emitida',     (v_nfse.id IS NOT NULL),
    'nfse_existente', CASE WHEN v_nfse.id IS NOT NULL THEN jsonb_build_object(
        'id',      v_nfse.id,
        'numero',  v_nfse.numero,
        'status',  v_nfse.status,
        'pdf_url', v_nfse.pdf_url
    ) ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_pedido_nfse_marcar_emitida(
  p_pedido_id uuid,
  p_provider_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido nao encontrado');
  END IF;

  UPDATE erp_nfse_emitidas
     SET pedido_id = p_pedido_id
   WHERE provider_reference = p_provider_reference
     AND company_id = v_company
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', v_id IS NOT NULL, 'nfse_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_pedido_nfse_dados(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pedido_nfse_marcar_emitida(uuid, text) TO authenticated;
