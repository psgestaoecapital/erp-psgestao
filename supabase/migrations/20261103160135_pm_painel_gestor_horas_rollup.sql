-- P&M · /dashboard/pm/painel-gestor (Painel do gestor · Tempo) · integridade do rollup de horas (PDCA auditor_pdca_2)
--
-- Problema PROVADO no dado (RD-38, DEMO Agência b0700000-...-002): agency_jobs.horas_realizadas estava SEMPRE 0 —
-- nenhum writer o mantinha (o app só LÊ a coluna em painel-gestor, painel-jobs, CargaEquipe e produção; nunca grava),
-- apesar de agency_timesheet ter apontamentos reais (7 jobs com 40,5/27/20,25/13,5/9,68 h etc.). Resultado: as seções
-- "Jobs sem horas" (inflada) e "Alerta 80%" (vazia) do painel NÃO batiam no dado.
--
-- Esta migration CONSOLIDA horas_realizadas a partir de agency_timesheet por GATILHO (assim TODOS os leitores passam a
-- bater no dado, não só o painel) + um BACKFILL único. É ADITIVA e segura:
--   - horas_realizadas é CAMPO DERIVADO; o dado PRIMÁRIO (agency_timesheet) não é tocado;
--   - nenhuma RLS/policy/grant existente é alterada; o gatilho e as funções têm REVOKE anon;
--   - o backfill tem WHERE e é SET-BASED (soma agrupada, não varre função por linha — doutrina do incidente 03/10);
--   - só corrige o derivado para jobs que TÊM apontamento; jamais apaga dado primário de cliente.

-- (1) índice de apoio ao gatilho (soma por job) --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agency_timesheet_job ON public.agency_timesheet (job_id) WHERE job_id IS NOT NULL;

-- (2) recomputa o realizado de UM job a partir do timesheet --------------------------------------------------------
-- ci-sem-guarda: fn_agency_job_horas_recalc — recomputa APENAS o campo DERIVADO horas_realizadas do job a partir do
--   próprio timesheet; é chamada SÓ pelo gatilho trg_agency_timesheet_horas (REVOKE de PUBLIC/anon/authenticated, nenhum
--   cliente a invoca). A mutação da agency_timesheet que dispara o gatilho já é guardada por RLS (company_id); não há
--   caminho para recomputar o job de outra empresa, e não se grava dado primário de cliente.
CREATE OR REPLACE FUNCTION public.fn_agency_job_horas_recalc(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_h numeric;
BEGIN
  IF p_job_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(sum(ts.horas), 0) INTO v_h FROM public.agency_timesheet ts WHERE ts.job_id = p_job_id;
  UPDATE public.agency_jobs j
     SET horas_realizadas = v_h
   WHERE j.id = p_job_id AND COALESCE(j.horas_realizadas, 0) <> v_h;
END $function$;
REVOKE ALL ON FUNCTION public.fn_agency_job_horas_recalc(uuid) FROM PUBLIC, anon, authenticated;

-- (3) gatilho: todo apontamento (insert/update/delete) reconsolida o(s) job(s) afetado(s) -------------------------
CREATE OR REPLACE FUNCTION public.trg_agency_timesheet_horas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.fn_agency_job_horas_recalc(NEW.job_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
    PERFORM public.fn_agency_job_horas_recalc(OLD.job_id);
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.trg_agency_timesheet_horas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agency_timesheet_horas ON public.agency_timesheet;
CREATE TRIGGER trg_agency_timesheet_horas
  AFTER INSERT OR DELETE OR UPDATE OF horas, job_id ON public.agency_timesheet
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_timesheet_horas();

-- (4) backfill único: corrige o derivado para os jobs que têm apontamento (WHERE, set-based) ---------------------
UPDATE public.agency_jobs j
   SET horas_realizadas = s.h
  FROM (SELECT job_id, sum(horas) AS h FROM public.agency_timesheet WHERE job_id IS NOT NULL GROUP BY job_id) s
 WHERE j.id = s.job_id AND COALESCE(j.horas_realizadas, 0) <> s.h;
