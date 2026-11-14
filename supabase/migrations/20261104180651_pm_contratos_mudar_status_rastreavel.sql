-- PDCA P&M · /dashboard/pm/contratos (Fees) · gap 4 do auditor (RD-98 — rastro de status)
-- Problema: mudarStatus() gravava direto em agency_contratos pelo cliente
--   (supabase.from('agency_contratos').update(...)) SEM rastro/audit. Mudar o status de um
--   contrato (ativar/suspender/reativar/encerrar) é ação relevante e precisa ficar no audit_log_global.
-- Solução (padrão da fn_agency_cobranca_estornar): RPC SECURITY DEFINER com guarda de empresa,
--   validação do enum de status (mesmo CHECK da tabela) e INSERT em audit_log_global.
-- ADITIVA: só cria função nova; não altera dado de cliente nem estrutura de tabela.

CREATE OR REPLACE FUNCTION public.fn_agency_contrato_mudar_status(
  p_contrato_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.agency_contratos%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('rascunho','ativo','suspenso','encerrado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;

  SELECT * INTO v_r FROM agency_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Guarda multi-tenant (RD-45): a empresa do contrato tem de estar no escopo do usuário (ou admin).
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: mesmo status não gera escrita nem ruído no audit.
  IF v_r.status IS NOT DISTINCT FROM p_status THEN
    RETURN jsonb_build_object('ok', true, 'inalterado', true, 'status', p_status);
  END IF;

  UPDATE agency_contratos
     SET status = p_status, atualizado_em = now()
   WHERE id = p_contrato_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_r.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_contratos', p_contrato_id::text, 'contrato_mudar_status',
            jsonb_build_object('status', v_r.status),
            jsonb_build_object('status', p_status));
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_mudar_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_mudar_status(uuid, text) TO authenticated, service_role;
