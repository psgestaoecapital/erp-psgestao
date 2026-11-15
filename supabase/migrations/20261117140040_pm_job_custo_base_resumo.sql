-- P&M · FASE 2-B item 3 — base da precificação por tipo de job (ADITIVA, somente leitura)
--
-- Cruza, por TIPO de job, três fontes já existentes para servir de base de custo:
--   (1) tempo de CICLO automático (do histórico de status agency_job_status_hist, item 1/PR #4456):
--       diferença entre a 1ª transição e a última transição terminal (concluida/publicado) do job;
--   (2) horas ESTIMADAS vs REALIZADAS do próprio job (agency_jobs.horas_estimadas/realizadas);
--   (3) horas APONTADAS no timesheet (SUM de agency_timesheet.horas por job, fn_pm_timesheet_apontar).
--
-- COMPLEMENTA fn_pm_job_tempo_etapa_resumo (item 2/PR #4949), que detalha o tempo por ETAPA.
-- Aqui o recorte é por TIPO, pronto para a tela Margem/Rentabilidade consumir (item 4).
--
-- Guarda de empresa: só libera company do chamador (get_user_company_ids) ou admin — igual ao item 2.
-- STABLE/SECURITY DEFINER, somente leitura, não grava nada. Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.fn_pm_job_custo_base_resumo(
  p_company_id uuid,
  p_tipo       text        DEFAULT NULL,
  p_de         timestamptz DEFAULT NULL,
  p_ate        timestamptz DEFAULT NULL
)
RETURNS TABLE(
  tipo                   text,
  n_jobs                 integer,
  n_concluidos           integer,
  media_ciclo_horas      numeric,
  mediana_ciclo_horas    numeric,
  media_horas_estimadas  numeric,
  media_horas_realizadas numeric,
  media_horas_apontadas  numeric,
  desvio_medio_horas     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    -- só libera a empresa se o chamador for membro dela (ou admin)
    SELECT 1
    WHERE (p_company_id IN (SELECT get_user_company_ids())) OR is_admin()
  ),
  hist AS (
    SELECT h.job_id, h.para_status, h.mudou_em
    FROM public.agency_job_status_hist h
    WHERE h.company_id = p_company_id
      AND EXISTS (SELECT 1 FROM guard)
      AND (p_de  IS NULL OR h.mudou_em >= p_de)
      AND (p_ate IS NULL OR h.mudou_em <  p_ate)
  ),
  ciclo AS (
    SELECT job_id,
           MIN(mudou_em) AS ini,
           MAX(mudou_em) FILTER (WHERE para_status IN ('concluida','publicado')) AS fim_terminal
    FROM hist
    GROUP BY job_id
  ),
  jobs AS (
    SELECT j.id, j.tipo, j.horas_estimadas, j.horas_realizadas
    FROM public.agency_jobs j
    WHERE j.company_id = p_company_id
      AND j.excluido_em IS NULL
      AND (p_tipo IS NULL OR j.tipo = p_tipo)
      AND j.id IN (SELECT job_id FROM ciclo)
  ),
  aponta AS (
    SELECT t.job_id, SUM(t.horas) AS horas_apontadas
    FROM public.agency_timesheet t
    WHERE t.company_id = p_company_id
      AND t.excluido_em IS NULL
      AND t.job_id IN (SELECT id FROM jobs)
    GROUP BY t.job_id
  ),
  base AS (
    SELECT j.tipo,
           j.id,
           j.horas_estimadas,
           j.horas_realizadas,
           a.horas_apontadas,
           CASE WHEN c.fim_terminal IS NOT NULL AND c.ini IS NOT NULL
                THEN EXTRACT(EPOCH FROM (c.fim_terminal - c.ini)) / 3600.0
           END AS ciclo_horas   -- só jobs que chegaram a terminal têm ciclo fechado
    FROM jobs j
    JOIN ciclo  c ON c.job_id = j.id
    LEFT JOIN aponta a ON a.job_id = j.id
  )
  SELECT
    COALESCE(tipo, '(sem tipo)')                                  AS tipo,
    COUNT(*)::int                                                 AS n_jobs,
    COUNT(ciclo_horas)::int                                       AS n_concluidos,
    round(AVG(ciclo_horas), 4)                                    AS media_ciclo_horas,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ciclo_horas))::numeric, 4) AS mediana_ciclo_horas,
    round(AVG(horas_estimadas), 4)                                AS media_horas_estimadas,
    round(AVG(horas_realizadas), 4)                               AS media_horas_realizadas,
    round(AVG(horas_apontadas), 4)                                AS media_horas_apontadas,
    round(AVG(horas_realizadas - horas_estimadas), 4)             AS desvio_medio_horas
  FROM base
  GROUP BY COALESCE(tipo, '(sem tipo)')
  ORDER BY tipo;
$function$;

-- Regra 1 (check_fn_guards): REVOKE/GRANT explícito — função nova fechada a quem não está logado.
REVOKE ALL ON FUNCTION public.fn_pm_job_custo_base_resumo(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_custo_base_resumo(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;
