-- PM / Aprovação Cliente (#dbefa47b PDCA · RD-98 rastro da decisão)
-- A decisão de aprovar/reprovar um job (fn_pm_job_mover_status) só gravava status + updated_at,
-- sem registrar QUEM decidiu nem deixar rastro em audit_log. Numa tela de aprovação de cliente,
-- a decisão precisa de rastro.
-- Mudança ADITIVA: 2 colunas novas em agency_jobs (decidido_por/decidido_em) + CREATE OR REPLACE
-- da RPC existente para gravar quem decidiu e escrever audit_log_global (padrão fn_agency_comissao_marcar_paga).
-- Sem alterar assinatura nem RLS (agency_jobs já tem RLS por company_id).

ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS decidido_por uuid,
  ADD COLUMN IF NOT EXISTS decidido_em  timestamptz;

COMMENT ON COLUMN public.agency_jobs.decidido_por IS 'Usuário que moveu o status (aprovou/reprovou) na tela de Aprovação — rastro RD-98.';
COMMENT ON COLUMN public.agency_jobs.decidido_em  IS 'Quando o status foi movido pela última vez via fn_pm_job_mover_status.';

CREATE OR REPLACE FUNCTION public.fn_pm_job_mover_status(p_job_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
  v_status_atual text;
  v_uid uuid := auth.uid();
BEGIN
  IF p_status NOT IN ('nao_iniciada','em_producao','em_aprovacao','concluida','publicado') THEN
    RETURN jsonb_build_object('ok',false,'erro','status invalido');
  END IF;
  SELECT company_id, status INTO v_comp, v_status_atual FROM agency_jobs WHERE id = p_job_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao');
  END IF;

  UPDATE agency_jobs
     SET status = p_status,
         updated_at = now(),
         decidido_por = v_uid,
         decidido_em = now()
   WHERE id = p_job_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_jobs', p_job_id::text,
          'pm_job_mover_status',
          jsonb_build_object('status', v_status_atual),
          jsonb_build_object('status', p_status, 'decidido_por', v_uid, 'decidido_em', now()));

  RETURN jsonb_build_object('ok',true,'status',p_status);
END;
$function$;
