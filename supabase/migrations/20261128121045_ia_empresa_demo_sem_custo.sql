-- CEO 26/11/2026 14:07: "na empresa demo não pode gastar créditos".
-- Toda empresa de DEMONSTRAÇÃO (companies.is_demo) fica sem IA paga: fn_ia_empresa_pode_gastar devolve pode=false com
-- motivo 'empresa_demo' ANTES de qualquer outra regra, para TODAS as features que passam pelo teto por empresa
-- (Consultor IA e aiGuardedCall). Motivo: em 26/11, 17 perguntas de teste na DEMO Comércio GE gastaram US$ 2,08 e
-- estouraram o teto GLOBAL do dia, deixando todos os clientes sem o assistente. Prova automática de IA usa mock;
-- prova ao vivo só em empresa real autorizada pelo CEO. O resto da função é idêntico à versão viva.
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_pode_gastar(p_company_id uuid, p_feature text, p_custo_estimado numeric DEFAULT 0.01)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_hab boolean; v_lim numeric; v_cons numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'sem acesso'); END IF;
  -- CEO 26/11: empresa de demonstração não gasta crédito de IA.
  IF EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'empresa_demo'); END IF;
  SELECT habilitado, limite_diario_usd INTO v_hab, v_lim
    FROM ia_config_empresa WHERE company_id = p_company_id AND feature = p_feature;
  v_hab := coalesce(v_hab, (SELECT default_habilitado FROM ia_feature_catalogo WHERE feature = p_feature), true);
  IF NOT v_hab THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'IA desativada para esta clínica'); END IF;
  v_cons := coalesce((SELECT custo_usd FROM ia_consumo_empresa WHERE company_id = p_company_id AND feature = p_feature AND data_referencia = current_date), 0);
  IF v_lim IS NOT NULL AND (v_cons + coalesce(p_custo_estimado,0)) > v_lim THEN
    RETURN jsonb_build_object('habilitado', true, 'pode', false, 'motivo', 'limite diário da clínica atingido', 'consumo_hoje', v_cons, 'limite', v_lim); END IF;
  RETURN jsonb_build_object('habilitado', true, 'pode', true, 'consumo_hoje', v_cons, 'limite', v_lim);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid, text, numeric) TO authenticated, service_role;
