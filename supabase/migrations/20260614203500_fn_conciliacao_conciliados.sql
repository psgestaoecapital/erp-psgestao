-- =============================================================
-- ONDA-A-INBOX-SELO-v1 · fn_conciliacao_conciliados
-- =============================================================
-- Listagem dos movimentos ja conciliados para a aba "Conciliados"
-- da tela /financeiro/conciliacao/inbox.
-- Faz join "polimorfico" com erp_pagar/erp_receber pra trazer
-- contraparte (fornecedor/cliente), valor e data_vencimento.
-- Campo precisao: COALESCE(psgc_confianca, match_score).
--
-- Aplicada via MCP em 2026-06-14.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_conciliados(
  p_company_id uuid, p_limite int DEFAULT 100
) RETURNS TABLE(
  movimento_id uuid, lote_nome text, data_transacao date, valor numeric,
  descricao text, natureza text, lancamento_tabela text, lancamento_id uuid,
  contraparte text, valor_lancamento numeric, data_lancamento date,
  precisao numeric, match_origem text, conciliado_em timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT m.id, cl.nome, m.data_transacao, m.valor, m.descricao, m.natureza,
    m.lancamento_tabela, m.lancamento_id,
    CASE m.lancamento_tabela
      WHEN 'erp_pagar'   THEN (SELECT COALESCE(p.fornecedor_nome,p.descricao) FROM erp_pagar p   WHERE p.id=m.lancamento_id)
      WHEN 'erp_receber' THEN (SELECT COALESCE(r.cliente_nome,r.descricao)     FROM erp_receber r WHERE r.id=m.lancamento_id)
    END,
    CASE m.lancamento_tabela
      WHEN 'erp_pagar'   THEN (SELECT p.valor FROM erp_pagar p   WHERE p.id=m.lancamento_id)
      WHEN 'erp_receber' THEN (SELECT r.valor FROM erp_receber r WHERE r.id=m.lancamento_id)
    END,
    CASE m.lancamento_tabela
      WHEN 'erp_pagar'   THEN (SELECT p.data_vencimento FROM erp_pagar p   WHERE p.id=m.lancamento_id)
      WHEN 'erp_receber' THEN (SELECT r.data_vencimento FROM erp_receber r WHERE r.id=m.lancamento_id)
    END,
    COALESCE(m.psgc_confianca, m.match_score), m.match_origem, m.match_aplicado_em
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  WHERE m.company_id = p_company_id AND m.status = 'conciliado'
  ORDER BY m.match_aplicado_em DESC NULLS LAST
  LIMIT p_limite;
$$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_conciliados(uuid, int) TO authenticated;
