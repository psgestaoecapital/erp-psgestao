-- RD-41 · Fase 1 (Saneamento) — Conciliação: exibir baixa/contraparte de conciliação AGRUPADA.
-- Origem: Jordana KGF — movimento 21b8dbdf (LIQ.COBRANCA, R$ 1.280 = 2 boletos pagos) aparecia como
-- "BAIXA 0% / sem contraparte / R$ 0,00" na aba Conciliados. O dado está certo (2 vínculos, títulos pagos);
-- só a RPC de exibição não lia conciliacao_vinculo p/ agrupados (lancamento_id IS NULL).
-- RD-58: o badge não pode mentir. SEM mudança de dado — apenas leitura.
-- Movimentos 1:1 (lancamento_id preenchido) ficam IDÊNTICOS (COALESCE prioriza o caminho atual).

CREATE OR REPLACE FUNCTION public.fn_conciliacao_conciliados(p_company_id uuid, p_limite integer DEFAULT 100)
 RETURNS TABLE(movimento_id uuid, lote_id uuid, lote_nome text, data_transacao date, valor numeric, descricao text, natureza text, lancamento_tabela text, lancamento_id uuid, contraparte text, valor_lancamento numeric, data_lancamento date, precisao numeric, match_origem text, conciliado_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.lote_id, cl.nome, m.data_transacao, m.valor, m.descricao, m.natureza,
    m.lancamento_tabela, m.lancamento_id,
    -- contraparte: 1:1 pelo lancamento_id; senão agregada dos vínculos (fatura agrupada)
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT COALESCE(p.fornecedor_nome,p.descricao) FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT COALESCE(r.cliente_nome,r.descricao)     FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT CASE
                WHEN COUNT(*) = 0 THEN NULL
                WHEN COUNT(*) = 1 THEN MAX(COALESCE(r.cliente_nome, p.fornecedor_nome, r.descricao, p.descricao))
                ELSE 'Fatura agrupada (' || COUNT(*) || ' títulos)'
              END
         FROM conciliacao_vinculo cv
         LEFT JOIN erp_receber r ON r.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_receber'
         LEFT JOIN erp_pagar   p ON p.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_pagar'
        WHERE cv.movimento_id = m.id)
    ) AS contraparte,
    -- valor_lancamento: 1:1 valor do título; senão SUM(valor_vinculado) dos vínculos
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT p.valor FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT r.valor FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT SUM(cv.valor_vinculado) FROM conciliacao_vinculo cv WHERE cv.movimento_id = m.id)
    ) AS valor_lancamento,
    -- data_lancamento: 1:1 vencimento; senão MAX(vencimento) dos títulos vinculados
    COALESCE(
      CASE m.lancamento_tabela
        WHEN 'erp_pagar'   THEN (SELECT p.data_vencimento FROM erp_pagar p   WHERE p.id=m.lancamento_id)
        WHEN 'erp_receber' THEN (SELECT r.data_vencimento FROM erp_receber r WHERE r.id=m.lancamento_id)
      END,
      (SELECT MAX(COALESCE(r.data_vencimento, p.data_vencimento))
         FROM conciliacao_vinculo cv
         LEFT JOIN erp_receber r ON r.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_receber'
         LEFT JOIN erp_pagar   p ON p.id = cv.lancamento_id AND cv.lancamento_tabela = 'erp_pagar'
        WHERE cv.movimento_id = m.id)
    ) AS data_lancamento,
    -- precisao (badge %): confiança do auto-match (1:1 inalterado). Para AGRUPADO (sem confiança) usa a
    -- COBERTURA de valor: SUM(vínculos)/valor do movimento → 100% quando a fatura fecha (RD-58).
    COALESCE(
      m.psgc_confianca, m.match_score,
      CASE WHEN m.lancamento_id IS NULL THEN
        (SELECT ROUND(100.0 * ABS(SUM(cv.valor_vinculado)) / NULLIF(ABS(m.valor), 0), 0)
           FROM conciliacao_vinculo cv WHERE cv.movimento_id = m.id)
      END
    ) AS precisao,
    m.match_origem, m.match_aplicado_em
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  WHERE m.company_id = p_company_id AND m.status = 'conciliado'
  ORDER BY m.match_aplicado_em DESC NULLS LAST
  LIMIT p_limite;
$function$;
