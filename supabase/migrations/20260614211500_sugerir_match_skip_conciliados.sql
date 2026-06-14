-- =============================================================
-- ONDA-A · PATCH sugerir_match: ignorar lancamentos JA conciliados
-- =============================================================
-- Antes: fn_conciliacao_sugerir_match podia sugerir um lancamento
-- que ja estava amarrado em outro movimento status='conciliado',
-- gerando duplo-vinculo (UI aceitava, runner pegava na anti-colisao
-- mas era ruido).
--
-- Agora: NOT EXISTS em conciliacao_movimento status='conciliado'
-- para cada lancamento candidato (mesma logica do anti-colisao do
-- runner, antecipada na sugestao). Reduz colisao_pulada e melhora
-- a aparencia da inbox (sumiu sugestao "morta").
--
-- Aplicada via MCP em 2026-06-14.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match(
  p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date,
   valor_lancamento numeric, descricao_lancamento text, contraparte text,
   match_score numeric, match_categoria text, motivo text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_mov RECORD;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT
      'erp_pagar'::text AS tabela, p.id AS lanc_id,
      p.data_vencimento::date AS data_lanc, p.valor::numeric AS valor_lanc,
      COALESCE(p.descricao, p.fornecedor_nome, '')::text AS desc_lanc,
      p.fornecedor_nome::text AS contrap,
      ( CASE WHEN abs(p.valor - v_mov.valor) < 0.01 THEN 50
             WHEN abs(p.valor - v_mov.valor) <= 1 THEN 40
             WHEN abs(p.valor - v_mov.valor) <= 10 THEN 25
             WHEN abs(p.valor - v_mov.valor) / NULLIF(v_mov.valor,0) < 0.05 THEN 15
             ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 7 THEN 10
             ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')), v_mov.descricao_normalizada) >= 0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')), v_mov.descricao_normalizada) >= 0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')), v_mov.descricao_normalizada) >= 0.2 THEN 5
             ELSE 0 END )::numeric AS score
    FROM erp_pagar p
    WHERE p.company_id = v_mov.company_id
      AND p.status IN ('aberto','pago')
      AND p.data_vencimento BETWEEN v_mov.data_transacao - INTERVAL '15 days' AND v_mov.data_transacao + INTERVAL '15 days'
      AND v_mov.natureza = 'debito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2
        WHERE cm2.lancamento_id = p.id AND cm2.lancamento_tabela = 'erp_pagar' AND cm2.status = 'conciliado')

    UNION ALL

    SELECT
      'erp_receber'::text AS tabela, r.id AS lanc_id,
      r.data_vencimento::date AS data_lanc, r.valor::numeric AS valor_lanc,
      COALESCE(r.descricao, r.cliente_nome, '')::text AS desc_lanc,
      r.cliente_nome::text AS contrap,
      ( CASE WHEN abs(r.valor - v_mov.valor) < 0.01 THEN 50
             WHEN abs(r.valor - v_mov.valor) <= 1 THEN 40
             WHEN abs(r.valor - v_mov.valor) <= 10 THEN 25
             WHEN abs(r.valor - v_mov.valor) / NULLIF(v_mov.valor,0) < 0.05 THEN 15
             ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 7 THEN 10
             ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')), v_mov.descricao_normalizada) >= 0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')), v_mov.descricao_normalizada) >= 0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')), v_mov.descricao_normalizada) >= 0.2 THEN 5
             ELSE 0 END )::numeric AS score
    FROM erp_receber r
    WHERE r.company_id = v_mov.company_id
      AND r.status IN ('aberto','pago')
      AND r.data_vencimento BETWEEN v_mov.data_transacao - INTERVAL '15 days' AND v_mov.data_transacao + INTERVAL '15 days'
      AND v_mov.natureza = 'credito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2
        WHERE cm2.lancamento_id = r.id AND cm2.lancamento_tabela = 'erp_receber' AND cm2.status = 'conciliado')
  )
  SELECT c.tabela, c.lanc_id, c.data_lanc, c.valor_lanc, c.desc_lanc, c.contrap, c.score,
    (CASE WHEN c.score >= 90 THEN 'perfeito' WHEN c.score >= 60 THEN 'quase' ELSE 'fraco' END)::text,
    ('valor_diff='||(c.valor_lanc - v_mov.valor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (c.data_lanc::timestamp - v_mov.data_transacao::timestamp)))::text)::text
  FROM candidatos c
  WHERE c.score > 30
  ORDER BY c.score DESC
  LIMIT p_max_sugestoes;
END;
$function$;
