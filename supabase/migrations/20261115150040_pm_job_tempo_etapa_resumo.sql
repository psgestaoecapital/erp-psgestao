-- FASE 2-B item 2 (medição automática de tempo por etapa — base da precificação)
-- Code: code-desenvolvedor-3
--
-- Complementa o item 1 (PR #4456: tabela agency_job_status_hist + trigger +
-- fn_pm_job_tempo_etapa por job). Aqui entregamos a AGREGAÇÃO: tempo médio/mediana/p90
-- por ETAPA (status) e por TIPO de job, para a tela de Margem/Rentabilidade consumir
-- e para calcular custo médio por tipo de serviço.
--
-- Aditivo e de LEITURA (nenhuma coluna/linha de cliente é alterada).
-- Guarda de membership por company_id (mesmo contrato da fn_pm_job_tempo_etapa):
-- só devolve dados da empresa quando o chamador é membro dela (ou admin).

CREATE OR REPLACE FUNCTION public.fn_pm_job_tempo_etapa_resumo(
  p_company_id uuid,
  p_tipo       text        DEFAULT NULL,
  p_de         timestamptz DEFAULT NULL,
  p_ate        timestamptz DEFAULT NULL
)
RETURNS TABLE(
  tipo          text,
  status        text,
  n_jobs        integer,
  n_amostras    integer,
  media_horas   numeric,
  mediana_horas numeric,
  p90_horas     numeric,
  total_horas   numeric,
  n_abertos     integer
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
  trans AS (
    SELECT j.tipo        AS tipo,
           h.para_status AS status,
           h.job_id      AS job_id,
           h.mudou_em    AS entrou_em,
           LEAD(h.mudou_em) OVER (PARTITION BY h.job_id ORDER BY h.mudou_em, h.id) AS saiu_em
    FROM public.agency_job_status_hist h
    JOIN public.agency_jobs j
      ON j.id = h.job_id AND j.company_id = h.company_id
    WHERE h.company_id = p_company_id
      AND EXISTS (SELECT 1 FROM guard)
      AND (p_tipo IS NULL OR j.tipo = p_tipo)
      AND (p_de   IS NULL OR h.mudou_em >= p_de)
      AND (p_ate  IS NULL OR h.mudou_em <  p_ate)
  ),
  dur AS (
    SELECT tipo, status, job_id,
           EXTRACT(EPOCH FROM (saiu_em - entrou_em)) / 3600.0 AS horas,
           (saiu_em IS NULL) AS aberto   -- etapa ainda em curso (sem transição posterior)
    FROM trans
  )
  SELECT
    COALESCE(tipo, '(sem tipo)')                                   AS tipo,
    status,
    COUNT(DISTINCT job_id)::int                                    AS n_jobs,
    COUNT(*) FILTER (WHERE NOT aberto)::int                        AS n_amostras,
    round(AVG(horas) FILTER (WHERE NOT aberto), 4)                 AS media_horas,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)
             FILTER (WHERE NOT aberto))::numeric, 4)               AS mediana_horas,
    round((percentile_cont(0.9) WITHIN GROUP (ORDER BY horas)
             FILTER (WHERE NOT aberto))::numeric, 4)               AS p90_horas,
    round(SUM(horas) FILTER (WHERE NOT aberto), 4)                 AS total_horas,
    COUNT(*) FILTER (WHERE aberto)::int                            AS n_abertos
  FROM dur
  GROUP BY COALESCE(tipo, '(sem tipo)'), status
  ORDER BY tipo, status;
$function$;

COMMENT ON FUNCTION public.fn_pm_job_tempo_etapa_resumo(uuid, text, timestamptz, timestamptz) IS
  'FASE 2-B/precificação (Code 3): tempo médio/mediana/p90/total por ETAPA (status) e por TIPO de job, '
  'a partir de agency_job_status_hist. Só intervalos fechados entram nas estatísticas; n_abertos conta as '
  'etapas ainda em curso. Guarda de membership por company_id (get_user_company_ids/is_admin).';

-- Leitura só para usuário autenticado (nunca anônimo).
REVOKE ALL ON FUNCTION public.fn_pm_job_tempo_etapa_resumo(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_tempo_etapa_resumo(uuid, text, timestamptz, timestamptz) TO authenticated;
