-- PM-T (3) · etapa e rodada automáticas no lançamento de horas (CEO 06/10, blueprint pm V8 00.5-B).
-- Aditiva e idempotente: coluna nova `rodada` em agency_timesheet + gatilho BEFORE INSERT que preenche, SÓ quando
-- vieram vazias, a etapa (pela situação do job) e a rodada (rodada_ajuste do job). Vale para o ▶, o manual e o celular.
-- Não altera linhas existentes (nenhum UPDATE/DELETE em dado de cliente); RLS e policies da tabela seguem como estão.
ALTER TABLE public.agency_timesheet ADD COLUMN IF NOT EXISTS rodada integer;

CREATE OR REPLACE FUNCTION public.fn_pm_timesheet_etapa_rodada()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text; v_rodada integer;
BEGIN
  IF NEW.job_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.etapa_tipo IS NOT NULL AND NEW.rodada IS NOT NULL THEN RETURN NEW; END IF;
  SELECT status, COALESCE(rodada_ajuste, 0) INTO v_status, v_rodada FROM public.agency_jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.etapa_tipo IS NULL THEN
    NEW.etapa_tipo := CASE v_status WHEN 'em_aprovacao' THEN 'aprovacao_job' WHEN 'publicado' THEN 'publicacao' ELSE 'job' END;
  END IF;
  IF NEW.rodada IS NULL THEN NEW.rodada := v_rodada; END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_pm_timesheet_etapa_rodada() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_pm_timesheet_etapa_rodada ON public.agency_timesheet;
CREATE TRIGGER trg_pm_timesheet_etapa_rodada BEFORE INSERT ON public.agency_timesheet
  FOR EACH ROW EXECUTE FUNCTION public.fn_pm_timesheet_etapa_rodada();
