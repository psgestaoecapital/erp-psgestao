-- RD-41 Fase 1.1 — Picker de movimentos compativeis com um titulo.
-- Usado pelo botao "Conciliar" em Contas a Pagar/Receber.
--
-- Retorna movimentos de conciliacao_movimento (status='pendente', lancamento_id NULL)
-- da mesma company, natureza compativel (pagar→debito, receber→credito),
-- data_transacao dentro de ±p_dias do vencimento do titulo, ordenados por
-- proximidade de valor e data.
--
-- SECURITY INVOKER: respeita RLS. A UI ja abre o modal para um titulo do
-- proprio company_id do usuario; e o RLS de conciliacao_movimento vai filtrar.
-- Aplicada via MCP em 2026-07-02.

CREATE OR REPLACE FUNCTION public.fn_movimentos_compativeis_titulo(
  p_titulo_tabela text,
  p_titulo_id     uuid,
  p_dias          integer DEFAULT 15
)
RETURNS TABLE (
  id                uuid,
  lote_id           uuid,
  conta_bancaria_id uuid,
  data_transacao    date,
  valor             numeric,
  descricao         text,
  natureza          text,
  documento         text,
  match_score       numeric,
  diff_valor        numeric,
  diff_dias         integer
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company uuid;
  v_valor   numeric;
  v_venc    date;
  v_natureza_esperada text;
BEGIN
  IF p_titulo_tabela NOT IN ('erp_pagar','erp_receber') THEN
    RAISE EXCEPTION 'p_titulo_tabela invalido: %', p_titulo_tabela;
  END IF;
  IF p_titulo_id IS NULL THEN
    RAISE EXCEPTION 'p_titulo_id obrigatorio';
  END IF;

  IF p_titulo_tabela = 'erp_pagar' THEN
    SELECT p.company_id, p.valor, p.data_vencimento
      INTO v_company, v_valor, v_venc
      FROM public.erp_pagar p WHERE p.id = p_titulo_id;
    v_natureza_esperada := 'debito';
  ELSE
    SELECT r.company_id, r.valor, r.data_vencimento
      INTO v_company, v_valor, v_venc
      FROM public.erp_receber r WHERE r.id = p_titulo_id;
    v_natureza_esperada := 'credito';
  END IF;

  IF v_company IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.lote_id,
    l.conta_bancaria_id,
    m.data_transacao,
    m.valor,
    m.descricao,
    m.natureza,
    m.documento,
    (
      GREATEST(0, 60 - LEAST(60, (ABS(m.valor - v_valor) / GREATEST(v_valor, 1)) * 300))
      + GREATEST(0, 40 - LEAST(40, ABS(m.data_transacao - v_venc) * 3))
    )::numeric AS match_score,
    (m.valor - v_valor)::numeric AS diff_valor,
    (m.data_transacao - v_venc)::integer AS diff_dias
  FROM public.conciliacao_movimento m
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
  WHERE m.company_id = v_company
    AND m.lancamento_id IS NULL
    AND m.status = 'pendente'
    AND m.natureza = v_natureza_esperada
    AND m.data_transacao BETWEEN (v_venc - p_dias) AND (v_venc + p_dias)
  ORDER BY
    ABS(m.valor - v_valor) ASC,
    ABS(m.data_transacao - v_venc) ASC,
    m.data_transacao DESC
  LIMIT 50;
END $fn$;

GRANT EXECUTE ON FUNCTION public.fn_movimentos_compativeis_titulo(text, uuid, integer)
  TO authenticated;
