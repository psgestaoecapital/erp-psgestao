-- DF-e Onda 2.2 fix · RPC pra persistir auto_ciencia
-- Causa: erp_nfe_distribuicao_controle tem RLS on e so policy SELECT.
-- O UPDATE direto do frontend era bloqueado silenciosamente. Mesma
-- linha de raciocinio da fn_nfe_distribuicao_habilitar (que ja existe
-- pra mesma tabela). SECURITY DEFINER + check de get_user_company_ids()
-- OR is_admin() bypassa o RLS de forma controlada.

CREATE OR REPLACE FUNCTION public.fn_nfe_distribuicao_set_auto_ciencia(
  p_company_id uuid,
  p_auto       boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;

  UPDATE erp_nfe_distribuicao_controle
     SET auto_ciencia = p_auto,
         updated_at   = now()
   WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'controle nao encontrado');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'auto_ciencia', p_auto
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_nfe_distribuicao_set_auto_ciencia(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_distribuicao_set_auto_ciencia(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_nfe_distribuicao_set_auto_ciencia(uuid, boolean) IS
  'DF-e Onda 2.2 · liga/desliga auto-ciencia da empresa. SECURITY DEFINER '
  'com check de acesso · espelha o padrao de fn_nfe_distribuicao_habilitar.';
