-- AUDITORIA GOLD FASE 1 · RPC filtro por prioridade
-- Aplicado via MCP apply_migration 25/05/2026 ~20:00 BRT
--
-- Substitui o disparador único (fn_disparar_insight_auditor com NULL)
-- por uma versão que filtra system_screens.prioridade_monitoramento
-- e seleciona o modelo Anthropic via gatilho de custo:
--   • prioridade='critica' -> claude-sonnet-4-20250514 (caro · profundo)
--   • demais              -> claude-haiku-4-5-20250930 (~10x mais barato)
--
-- Modo econômico ativa quando custo_usd_hoje >= 4.50 (só audita 'critica').
-- Hard cap em limite_max_custo_usd_dia (default 5.00 pós-FASE-1).

CREATE OR REPLACE FUNCTION public.fn_disparar_insight_auditor_prioridade(
  p_prioridade text,
  p_limit integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_request_id bigint;
  v_url text := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/insight-auditor';
  v_body jsonb;
  v_budget RECORD;
  v_limit_real int;
  v_modelo text;
BEGIN
  PERFORM fn_recalcular_budget_anthropic();

  SELECT * INTO v_budget FROM anthropic_budget_control WHERE id = 1;

  IF v_budget.pausado THEN
    RETURN jsonb_build_object('erro', 'BUDGET PAUSADO', 'motivo', v_budget.motivo_pausa);
  END IF;

  IF v_budget.custo_usd_hoje >= 4.50 AND p_prioridade NOT IN ('critica') THEN
    RETURN jsonb_build_object(
      'erro', 'MODO ECONOMICO ATIVO',
      'motivo', 'Custo >= USD 4,50 · so audita critica',
      'custo_hoje', v_budget.custo_usd_hoje,
      'prioridade_solicitada', p_prioridade
    );
  END IF;

  IF v_budget.custo_usd_hoje >= v_budget.limite_max_custo_usd_dia THEN
    RETURN jsonb_build_object(
      'erro', 'HARD CAP ATINGIDO',
      'custo_hoje', v_budget.custo_usd_hoje,
      'limite_dia', v_budget.limite_max_custo_usd_dia
    );
  END IF;

  v_limit_real := LEAST(p_limit, v_budget.limite_max_telas_por_execucao);

  v_modelo := CASE
    WHEN p_prioridade = 'critica' THEN 'claude-sonnet-4-20250514'
    ELSE 'claude-haiku-4-5-20250930'
  END;

  v_body := jsonb_build_object(
    'limit', v_limit_real,
    'prioridade', p_prioridade,
    'model', v_modelo
  );

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
    ),
    body := v_body,
    timeout_milliseconds := 240000
  ) INTO v_request_id;

  UPDATE anthropic_budget_control SET ultima_execucao_em = NOW() WHERE id = 1;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'prioridade', p_prioridade,
    'modelo', v_modelo,
    'limit_real', v_limit_real,
    'custo_hoje_usd', v_budget.custo_usd_hoje,
    'limite_dia_usd', v_budget.limite_max_custo_usd_dia
  );
END;
$$;
