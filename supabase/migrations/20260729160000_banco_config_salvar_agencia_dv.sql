-- REMESSA · DV da agência não persistia (bug homologação, André). Causa: a RLS de erp_banco_provider_config
-- só permite INSERT/UPDATE ao service_role; o cliente (authenticated) só tem SELECT. O .update() do navegador
-- casava 0 linhas SEM erro → a tela dizia "DV salvo" mas o banco continuava null (agencia/agencia_dv).
--
-- Fix: RPC SECURITY DEFINER que persiste com guard de empresa (company do config ∈ get_user_company_ids ou admin)
-- e RETORNA os valores gravados, pra tela confirmar de verdade. Aditivo (RD-55). Não afeta a RLS existente.
CREATE OR REPLACE FUNCTION public.fn_banco_config_salvar_agencia_dv(
  p_config_id uuid, p_agencia_dv text, p_agencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_company uuid; v_ag text; v_dv text;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_banco_provider_config WHERE id = p_config_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'config_nao_encontrada'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  v_dv := NULLIF(btrim(p_agencia_dv), '');
  IF v_dv IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'dv_vazio'); END IF;

  UPDATE public.erp_banco_provider_config
     SET agencia_dv = v_dv,
         agencia = COALESCE(NULLIF(btrim(p_agencia), ''), agencia),  -- só sobrescreve se veio algo
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = p_config_id
   RETURNING agencia, agencia_dv INTO v_ag, v_dv;

  RETURN jsonb_build_object('sucesso', true, 'id', p_config_id, 'agencia', v_ag, 'agencia_dv', v_dv);
END $function$;
REVOKE ALL ON FUNCTION public.fn_banco_config_salvar_agencia_dv(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_banco_config_salvar_agencia_dv(uuid, text, text) TO authenticated;
