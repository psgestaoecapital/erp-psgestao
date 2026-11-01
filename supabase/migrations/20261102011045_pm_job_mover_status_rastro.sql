-- PDCA P&M · /dashboard/pm/aprovacao · RD-98: RASTRO DA DECISÃO
-- Gap (auditor_pdca_2, re-auditoria 31/10, nota 68): fn_pm_job_mover_status move o status
--   do job (aprovar = 'publicado' / reprovar = 'em_producao') mas NÃO grava quem decidiu
--   nem escreve em audit_log_global (só updated_at). Numa tela de aprovação de cliente, a
--   decisão tem de deixar rastro.
-- Correção (aditiva, mesmo padrão de audit das demais RPCs de P&M):
--   1) colunas aditivas decidido_por / decidido_em em agency_jobs;
--   2) a RPC grava decidido_por = auth.uid(), decidido_em = now() e um registro em
--      audit_log_global com status anterior/novo.
-- Assinatura (p_job_id uuid, p_status text) INALTERADA — callers:
--   src/app/dashboard/pm/aprovacao/page.tsx:42 e src/app/dashboard/producao/page.tsx:286,326.

ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS decidido_por uuid,
  ADD COLUMN IF NOT EXISTS decidido_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_pm_job_mover_status(p_job_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_comp       uuid;
  v_status_ant text;
  v_titulo     text;
BEGIN
  IF p_status NOT IN ('nao_iniciada','em_producao','em_aprovacao','concluida','publicado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status invalido');
  END IF;

  SELECT company_id, status, titulo INTO v_comp, v_status_ant, v_titulo
    FROM agency_jobs WHERE id = p_job_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao');
  END IF;

  UPDATE agency_jobs
     SET status = p_status, decidido_por = v_uid, decidido_em = now(), updated_at = now()
   WHERE id = p_job_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_jobs', p_job_id::text, 'job_status_' || p_status,
     jsonb_build_object('status', v_status_ant, 'titulo', v_titulo),
     jsonb_build_object('status', p_status, 'decidido_por', v_uid));

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$function$;

-- Reafirma a ACL da função SECURITY DEFINER (gate check-fn-guards / [revoke_anon]).
-- CREATE OR REPLACE só preserva a ACL onde a função já existe; em ambiente novo volta ao
-- default EXECUTE TO PUBLIC. Espelha a ACL viva hoje ({authenticated, service_role}).
REVOKE ALL ON FUNCTION public.fn_pm_job_mover_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_mover_status(uuid, text) TO authenticated, service_role;
