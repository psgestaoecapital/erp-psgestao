-- FASE 2-B · item 1 (fundação da medição de tempo por etapa do job) — CEO aprovou 09/11.
-- Objetivo: registrar, automaticamente, cada mudança de status de um job (nao_iniciada -> em_producao
-- -> em_aprovacao -> concluida -> publicado) para depois calcular o tempo em cada etapa (base da
-- precificação por tipo de serviço).
--
-- ADITIVO e SEGURO:
--  - NÃO altera fn_pm_job_mover_status (que, ao entrar em 'publicado', cria comissão). A captura é por
--    TRIGGER no UPDATE de agency_jobs.status — logo a cadeia de comissão fica intacta (sem CREATE OR
--    REPLACE da função sensível).
--  - Nova tabela com RLS por company_id + REVOKE anon. Nova trigger. Nova RPC de leitura. Backfill
--    idempotente a partir de audit_log_global (hoje 0 linhas de job_status_*; provado no PR).
-- Code: code-desenvolvedor-3

-- 1) HISTÓRICO DE STATUS DO JOB (tabela aditiva) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_job_status_hist (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  de_status   text,
  para_status text NOT NULL,
  mudou_em    timestamptz NOT NULL DEFAULT now(),
  mudou_por   uuid
);

CREATE INDEX IF NOT EXISTS idx_agency_job_status_hist_job
  ON public.agency_job_status_hist (job_id, mudou_em);
CREATE INDEX IF NOT EXISTS idx_agency_job_status_hist_company
  ON public.agency_job_status_hist (company_id, mudou_em);

-- RLS por empresa (mesmo padrão de agency_comissao) + REVOKE anon. Escrita só pela trigger (SECURITY
-- DEFINER); o usuário autenticado apenas lê a própria empresa.
ALTER TABLE public.agency_job_status_hist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_job_status_hist_sel ON public.agency_job_status_hist;
CREATE POLICY agency_job_status_hist_sel ON public.agency_job_status_hist
  FOR SELECT
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
REVOKE ALL ON public.agency_job_status_hist FROM anon;
GRANT SELECT ON public.agency_job_status_hist TO authenticated;

-- 2) TRIGGER: grava toda transição de status (qualquer caminho de UPDATE) --------------------------
CREATE OR REPLACE FUNCTION public.trg_agency_job_status_hist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- WHEN já garante status diferente; a checagem interna é defensiva.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.agency_job_status_hist (job_id, company_id, de_status, para_status, mudou_em, mudou_por)
    VALUES (
      NEW.id,
      NEW.company_id,
      OLD.status,
      NEW.status,
      COALESCE(NEW.decidido_em, now()),
      COALESCE(NEW.decidido_por, auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$fn$;
-- função de gatilho (disparada pelo UPDATE); nunca chamável por quem não está logado.
REVOKE ALL ON FUNCTION public.trg_agency_job_status_hist() FROM anon, public;

DROP TRIGGER IF EXISTS trg_agency_job_status_hist ON public.agency_jobs;
CREATE TRIGGER trg_agency_job_status_hist
  AFTER UPDATE OF status ON public.agency_jobs
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.trg_agency_job_status_hist();

-- 3) RPC DE LEITURA: tempo por etapa de um job ----------------------------------------------------
-- Para cada etapa por que o job passou: quando entrou, quando saiu (próxima transição; se ainda está
-- na etapa, usa now()) e a duração em segundos e horas. Guarda por empresa (SECURITY DEFINER + filtro).
CREATE OR REPLACE FUNCTION public.fn_pm_job_tempo_etapa(p_job_id uuid)
RETURNS TABLE(status text, entrou_em timestamptz, saiu_em timestamptz, segundos numeric, horas numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH guard AS (
    SELECT j.company_id
    FROM public.agency_jobs j
    WHERE j.id = p_job_id
      AND ((j.company_id IN (SELECT get_user_company_ids())) OR is_admin())
  ),
  trans AS (
    SELECT h.para_status AS status,
           h.mudou_em    AS entrou_em,
           LEAD(h.mudou_em) OVER (ORDER BY h.mudou_em, h.id) AS saiu_em
    FROM public.agency_job_status_hist h
    JOIN guard g ON g.company_id = h.company_id
    WHERE h.job_id = p_job_id
  )
  SELECT status,
         entrou_em,
         saiu_em,
         EXTRACT(EPOCH FROM (COALESCE(saiu_em, now()) - entrou_em))::numeric AS segundos,
         round((EXTRACT(EPOCH FROM (COALESCE(saiu_em, now()) - entrou_em)) / 3600.0)::numeric, 4) AS horas
  FROM trans
  ORDER BY entrou_em;
$fn$;

REVOKE ALL ON FUNCTION public.fn_pm_job_tempo_etapa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_tempo_etapa(uuid) TO authenticated;

-- 4) BACKFILL idempotente a partir de audit_log_global (job_status_*) ------------------------------
-- fn_pm_job_mover_status já grava cada transição em audit_log_global com acao='job_status_<novo>' e
-- valor_anterior->>'status' = o status antigo. Usa o índice (tabela, created_at). Idempotente: não
-- recria transição que já exista no histórico (inclusive as que a trigger passar a gravar).
INSERT INTO public.agency_job_status_hist (job_id, company_id, de_status, para_status, mudou_em, mudou_por)
SELECT (a.registro_id)::uuid,
       a.company_id,
       NULLIF(a.valor_anterior->>'status', ''),
       substring(a.acao FROM 'job_status_(.*)'),
       a.created_at,
       a.user_id
FROM public.audit_log_global a
WHERE a.tabela = 'agency_jobs'
  AND a.acao LIKE 'job_status_%'
  AND a.company_id IS NOT NULL
  AND substring(a.acao FROM 'job_status_(.*)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.id = (a.registro_id)::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_job_status_hist h
    WHERE h.job_id = (a.registro_id)::uuid
      AND h.para_status = substring(a.acao FROM 'job_status_(.*)')
      AND h.mudou_em = a.created_at
  );
