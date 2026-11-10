-- RD-98 pilar 4: inativar/reativar conta do plano registra QUEM e grava audit_log_global.
-- Gap do auditor em /dashboard/cadastros/plano-contas: PlanoContasList.tsx handleToggleAtivo
-- fazia UPDATE direto em erp_plano_contas, sem registrar autor, sem audit e ignorando {error}
-- (RLS barra -> usuario via "sucesso" falso). Esta RPC fecha o buraco.
--
-- Aditiva (RD-52): funcao NOVA, nao mexe em dado de cliente. SECURITY DEFINER com guarda
-- multi-tenant (get_user_company_ids/is_admin) porque bypassa RLS. REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_plano_contas_toggle_ativo(
  p_categoria_id uuid,
  p_ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.erp_plano_contas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_categoria_id IS NULL OR p_ativo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'parametros_invalidos');
  END IF;

  SELECT * INTO v_r FROM public.erp_plano_contas WHERE id = p_categoria_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Guarda multi-tenant: a conta tem de ser da empresa no escopo do usuario (ou admin).
  -- Conta de template global (company_id NULL) nunca e inativada por empresa.
  IF v_r.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_global_nao_editavel');
  END IF;
  IF NOT (v_r.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: mesmo estado nao gera escrita nem ruido no audit.
  IF v_r.ativo IS NOT DISTINCT FROM p_ativo THEN
    RETURN jsonb_build_object('ok', true, 'inalterado', true, 'ativo', p_ativo);
  END IF;

  UPDATE public.erp_plano_contas
     SET ativo = p_ativo
   WHERE id = p_categoria_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_r.company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
     'erp_plano_contas', p_categoria_id::text,
     CASE WHEN p_ativo THEN 'plano_conta_reativar' ELSE 'plano_conta_inativar' END,
     jsonb_build_object('ativo', v_r.ativo, 'codigo', v_r.codigo, 'descricao', v_r.descricao),
     jsonb_build_object('ativo', p_ativo));

  RETURN jsonb_build_object('ok', true, 'ativo', p_ativo, 'codigo', v_r.codigo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_toggle_ativo(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_toggle_ativo(uuid, boolean) TO authenticated;
