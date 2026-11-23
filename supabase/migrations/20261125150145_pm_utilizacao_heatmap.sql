-- P&M · Onda A (rentabilidade) · tela 121 "Planejamento de recursos e capacidade" (blueprint vertical=pm,
-- ref. mercado mundial · 23/11) · fatia 1 (backend) · Code: desenvolvedor_4_g
--
-- RPC aditiva que alimenta o Heatmap de utilização (faturável x não faturável) por pessoa e período.
-- Fonte REAL dos dados (RD-38, provado no dado antes de escrever):
--   - horas: public.agency_timesheet (vivos: excluido_em IS NULL), já com company_id/user_id/data/horas.
--   - faturável x não faturável: o job do apontamento está ligado a cliente/contrato/proposta
--       (agency_jobs.cliente_id/contrato_id/proposta_id) => faturável; job interno (sem nenhum) => não faturável.
--       Prova na base atual: 100% das 2444 linhas vivas caem em job faturável (0 interno) — o eixo
--       "não faturável" existe e fica em 0 hoje, correto, sem supor.
--   - capacidade: jornada_horas_dia de public.agency_equipe x dias úteis (seg–sex) da semana no período.
--   - semana: âncora na segunda-feira (date_trunc('week')), bucket natural do heatmap.
--
-- Segurança (mesmo padrão de fn_pm_equipe_custos):
--   SECURITY DEFINER + search_path fixo; guarda de empresa (42501 se fora das empresas do usuário);
--   dado INDIVIDUAL por pessoa => gated por public.fn__mao_obra_pode_ver_individual (LGPD/visibilidade).
--   Aditiva: não cria/altera tabela, não toca RLS/policy, não mexe em dado de cliente. REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_pm_utilizacao_heatmap(
  p_company_id uuid,
  p_de date DEFAULT (date_trunc('week', current_date) - interval '7 weeks')::date,
  p_ate date DEFAULT current_date
)
RETURNS TABLE(
  user_id uuid,
  pessoa text,
  cargo text,
  setor text,
  semana date,
  horas_faturavel numeric,
  horas_nao_faturavel numeric,
  horas_total numeric,
  jornada_horas_dia numeric,
  dias_uteis integer,
  capacidade_horas numeric,
  utilizacao_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_de  date := coalesce(p_de,  (date_trunc('week', current_date) - interval '7 weeks')::date);
  v_ate date := coalesce(p_ate, current_date);
BEGIN
  -- guarda de empresa (service role / rotina: auth.uid() IS NULL pula a checagem, como no padrão PM)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- horas por pessoa é dado individual (LGPD/visibilidade de produtividade): só quem pode ver individual
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RETURN;
  END IF;

  IF v_de > v_ate THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH semanas AS (
    SELECT date_trunc('week', d)::date AS semana,
           count(*) FILTER (WHERE extract(isodow FROM d) < 6)::int AS dias_uteis
    FROM generate_series(v_de, v_ate, interval '1 day') g(d)
    GROUP BY 1
  ),
  membros AS (
    SELECT e.user_id,
           e.nome AS pessoa,
           e.cargo,
           e.setor,
           coalesce(e.jornada_horas_dia, 8) AS jornada
    FROM public.agency_equipe e
    WHERE e.company_id = p_company_id
      AND e.excluido_em IS NULL
      AND e.ativo IS DISTINCT FROM false
      AND e.user_id IS NOT NULL
  ),
  apont AS (
    SELECT t.user_id,
           date_trunc('week', t.data)::date AS semana,
           coalesce(sum(t.horas) FILTER (
             WHERE j.cliente_id IS NOT NULL OR j.contrato_id IS NOT NULL OR j.proposta_id IS NOT NULL
           ), 0) AS h_fat,
           coalesce(sum(t.horas) FILTER (
             WHERE j.cliente_id IS NULL AND j.contrato_id IS NULL AND j.proposta_id IS NULL
           ), 0) AS h_nfat
    FROM public.agency_timesheet t
    JOIN public.agency_jobs j ON j.id = t.job_id
    WHERE t.company_id = p_company_id
      AND t.excluido_em IS NULL
      AND t.data BETWEEN v_de AND v_ate
    GROUP BY t.user_id, 2
  )
  SELECT m.user_id,
         m.pessoa,
         m.cargo,
         m.setor,
         s.semana,
         coalesce(a.h_fat, 0)                          AS horas_faturavel,
         coalesce(a.h_nfat, 0)                         AS horas_nao_faturavel,
         coalesce(a.h_fat, 0) + coalesce(a.h_nfat, 0)  AS horas_total,
         m.jornada                                     AS jornada_horas_dia,
         s.dias_uteis,
         (m.jornada * s.dias_uteis)                    AS capacidade_horas,
         round(100 * (coalesce(a.h_fat, 0) + coalesce(a.h_nfat, 0))
               / nullif(m.jornada * s.dias_uteis, 0), 1) AS utilizacao_pct
  FROM membros m
  CROSS JOIN semanas s
  LEFT JOIN apont a ON a.user_id = m.user_id AND a.semana = s.semana
  WHERE s.dias_uteis > 0
  ORDER BY m.pessoa, s.semana;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_pm_utilizacao_heatmap(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_utilizacao_heatmap(uuid, date, date) TO authenticated;
