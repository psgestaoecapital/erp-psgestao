-- Admin · incluir/excluir áreas contratadas (teto) por empresa. Origem: CEO 14/08. Sensível (acesso/billing).
-- Área contratada = tenant_subscriptions.status='active' (plan_id = a área, ex.: v15_wealth).
-- Só is_admin() (RD-25). Excluir é SOFT (subscription 'cancelled' + módulos is_active=false) — nunca apaga dados (RD-54).
--
-- DIVERGÊNCIAS auditadas vs. rascunho do SPEC (RD-26), corrigidas aqui:
--  • Catálogo v15 vive em plan_catalog (não em plans); preço = plan_catalog.preco_min (não monthly_price_brl).
--  • Mapa plano→módulos vive em plan_modules (via v_admin_plano_modulos). v15_wealth NÃO tinha nenhuma linha
--    em plan_modules — logo "ativar Wealth" acenderia ZERO módulos (mentira de UI, RD-58). Corrigido semeando
--    o vínculo no source-of-truth (plan_modules) com os 13 módulos wealth_* ativos do module_catalog.
--    → O CEO pode ajustar quais são default depois (is_default_active) sem mexer no código.

-- ── 1) Semeia o vínculo plano→módulos de v15_wealth (estava ausente) ─────────────────────────────
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT 'v15_wealth', m.id, true
FROM public.module_catalog m
WHERE m.ativo = true
  AND m.id LIKE 'wealth%'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = 'v15_wealth' AND pm.module_id = m.id);

-- ── 2) INCLUIR área: cria ou reativa a subscription + ativa os módulos default do plano ───────────
CREATE OR REPLACE FUNCTION public.fn_admin_area_incluir(p_company_id uuid, p_plan_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub uuid;
  v_preco numeric;
  v_mods int := 0;
BEGIN
  IF NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM plan_catalog WHERE id = p_plan_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'plano_inexistente');
  END IF;

  SELECT preco_min INTO v_preco FROM plan_catalog WHERE id = p_plan_id;

  -- reutiliza subscription existente (prioriza a não-cancelada) → nunca duplica
  SELECT id INTO v_sub FROM tenant_subscriptions
  WHERE company_id = p_company_id AND plan_id = p_plan_id
  ORDER BY (status = 'active') DESC, (status <> 'cancelled') DESC, created_at DESC
  LIMIT 1;

  IF v_sub IS NULL THEN
    INSERT INTO tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, current_period_start, created_by)
    VALUES (p_company_id, p_plan_id, 'active', COALESCE(v_preco, 0), 'monthly', now(), auth.uid())
    RETURNING id INTO v_sub;
  ELSE
    -- reativação preserva o preço/observação já negociados (ex.: wealth pending_setup = piloto)
    UPDATE tenant_subscriptions
    SET status = 'active', cancelled_at = NULL, updated_at = now()
    WHERE id = v_sub;
  END IF;

  -- ativa os módulos default do plano (source of truth = v_admin_plano_modulos → plan_modules)
  INSERT INTO tenant_modules_active (company_id, module_id, subscription_id, is_active, override_reason, activated_at, created_by)
  SELECT p_company_id, m.module_id, v_sub, true, 'plan_default', now(), auth.uid()
  FROM v_admin_plano_modulos m
  WHERE m.plan_id = p_plan_id AND m.is_default_active = true
  ON CONFLICT (company_id, module_id)
  DO UPDATE SET is_active = true, subscription_id = v_sub, deactivated_at = NULL, updated_at = now();
  GET DIAGNOSTICS v_mods = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub, 'plan_id', p_plan_id, 'modulos_ativados', v_mods);
END;
$function$;

-- ── 3) EXCLUIR área: cancela a subscription + desativa os módulos (SOFT — não apaga dados, RD-54) ──
CREATE OR REPLACE FUNCTION public.fn_admin_area_excluir(p_company_id uuid, p_plan_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub uuid;
  v_mods int := 0;
BEGIN
  IF NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE tenant_subscriptions
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE company_id = p_company_id AND plan_id = p_plan_id AND status = 'active'
  RETURNING id INTO v_sub;

  IF v_sub IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'area_nao_ativa'); END IF;

  UPDATE tenant_modules_active
  SET is_active = false, deactivated_at = now(), updated_at = now()
  WHERE company_id = p_company_id AND subscription_id = v_sub AND is_active = true;
  GET DIAGNOSTICS v_mods = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'acao', 'cancelada', 'modulos_desativados', v_mods);
END;
$function$;

-- ── 4) Lista áreas (planos v15) da empresa com flag "ativa" — alimenta o painel admin ─────────────
CREATE OR REPLACE FUNCTION public.fn_admin_areas_empresa(p_company_id uuid)
 RETURNS TABLE(plan_id text, nome text, vertical text, tier_internal text, grupo text, preco_min numeric, ativa boolean, sub_status text, observacao text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
    SELECT pc.id, pc.nome, pc.vertical, pc.tier_internal, pc.plan_group, pc.preco_min,
      EXISTS(SELECT 1 FROM tenant_subscriptions ts WHERE ts.company_id = p_company_id AND ts.plan_id = pc.id AND ts.status = 'active') AS ativa,
      (SELECT ts.status FROM tenant_subscriptions ts WHERE ts.company_id = p_company_id AND ts.plan_id = pc.id ORDER BY (ts.status = 'active') DESC, ts.created_at DESC LIMIT 1) AS sub_status,
      (SELECT ts.observacao FROM tenant_subscriptions ts WHERE ts.company_id = p_company_id AND ts.plan_id = pc.id ORDER BY (ts.status = 'active') DESC, ts.created_at DESC LIMIT 1) AS observacao
    FROM plan_catalog pc
    WHERE pc.legacy = false
    ORDER BY pc.vertical, pc.tier_internal NULLS FIRST, pc.nome;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_admin_area_incluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_area_excluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_areas_empresa(uuid) TO authenticated;
