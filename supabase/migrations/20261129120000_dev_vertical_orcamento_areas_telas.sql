-- Saneamento Fase 3 (telas reais) — Central de Dev: orçamento do "Atualizar a vertical" alinhado às áreas (follow-up da #6409).
--
-- Problema provado no dado (27/11): Industrial mostrava 24 telas no orçamento e 35 na auditoria. A #6409 passou a
-- auditoria (fn_dev_vertical_auditoria_status) para dev_vertical.areas_telas; o orçamento (fn_dev_vertical_orcamento) e a
-- rota POST /api/dev/atualizar-vertical ainda escolhiam as telas pelo CASE antigo de system_screens.area.
--
-- 1. fn_dev_vertical_orcamento conta as telas pelo MESMO filtro da auditoria:
--    system_screens.area = ANY(COALESCE(dev_vertical.areas_telas, ARRAY[slug])); vertical fora de dev_vertical = CASE antigo.
-- 2. O retorno ganha a chave 'areas' (áreas das telas contadas). A rota "Atualizar a vertical" usa essa lista para escolher
--    as telas que dispara no auditor, então orçamento, disparo e auditoria contam o mesmo conjunto.
--    Chaves que já existiam: mesmas, mesmo cálculo de custo/tempo/teto, mesma guarda (service_role ou PS admin).
--
-- Aditiva e idempotente. Não toca coleta nem ETL, não altera dado. O ADD COLUMN IF NOT EXISTS só protege a ordem de
-- publicação (a coluna é criada pela #6409; aqui é um no-op). RD-52: nome do arquivo = versão do ledger.

ALTER TABLE public.dev_vertical ADD COLUMN IF NOT EXISTS areas_telas text[];

CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento(p_vertical text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dv AS (
    SELECT COALESCE(d.areas_telas, ARRAY[d.slug]) AS areas
      FROM public.dev_vertical d WHERE d.slug = p_vertical
  ),
  sv AS (
    SELECT s.area FROM public.system_screens s
    WHERE CASE
            WHEN EXISTS (SELECT 1 FROM dv) THEN EXISTS (SELECT 1 FROM dv WHERE s.area = ANY(dv.areas))
            ELSE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
          END
  ),
  t AS (
    SELECT count(*)::int AS telas,
           COALESCE(array_agg(DISTINCT sv.area ORDER BY sv.area) FILTER (WHERE sv.area IS NOT NULL), ARRAY[]::text[]) AS areas
      FROM sv
  ),
  cap AS (
    SELECT limite_max_custo_usd_dia AS cap_dia, limite_max_custo_usd_mes AS cap_mes
    FROM public.anthropic_budget_control WHERE id = 1
  ),
  g AS (
    SELECT
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE analisado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE executado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0) )::numeric AS gasto_dia,
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE to_char(analisado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE to_char(executado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0) )::numeric AS gasto_mes
  )
  SELECT jsonb_build_object(
    'vertical', p_vertical, 'telas', t.telas, 'areas', to_jsonb(t.areas),
    'custo_estimado', round(t.telas*0.013,2), 'tempo_min', GREATEST(1, round(t.telas*0.3)::int),
    'gasto_dia', round(g.gasto_dia,2), 'gasto_mes', round(g.gasto_mes,2),
    'cap_dia', cap.cap_dia, 'cap_mes', cap.cap_mes,
    'pode', ( t.telas > 0
              AND g.gasto_dia + round(t.telas*0.013,2) <= cap.cap_dia
              AND g.gasto_mes + round(t.telas*0.013,2) <= cap.cap_mes ),
    'motivo', CASE
      WHEN t.telas = 0 THEN 'Esta vertical não tem telas catalogadas para auditar.'
      WHEN g.gasto_dia + round(t.telas*0.013,2) > cap.cap_dia
        THEN format('Teto diário (US$ %s) seria estourado. Gasto hoje US$ %s.',
                    to_char(cap.cap_dia,'FM990.00'), to_char(round(g.gasto_dia,2),'FM990.00'))
      WHEN g.gasto_mes + round(t.telas*0.013,2) > cap.cap_mes
        THEN format('Teto mensal (US$ %s) seria estourado. Gasto no mês US$ %s.',
                    to_char(cap.cap_mes,'FM990.00'), to_char(round(g.gasto_mes,2),'FM990.00'))
      ELSE NULL END)
  FROM t, cap, g
  WHERE (auth.role() = 'service_role' OR public.fn_eh_ps_admin());
$function$;

-- Mesmos grants de hoje (authenticated + service_role; anon/PUBLIC sem acesso).
REVOKE ALL ON FUNCTION public.fn_dev_vertical_orcamento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_orcamento(text) TO authenticated, service_role;
