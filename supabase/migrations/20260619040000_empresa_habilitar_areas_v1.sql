-- empresa-habilitar-areas · multi-flag por empresa via tenant_subscriptions
-- Decisao CEO: flag por area, usando plano_principal_id como default.

-- Parte 1 · toggle (habilita/desabilita area por slug)
CREATE OR REPLACE FUNCTION public.fn_empresa_area_toggle(
  p_company_id uuid,
  p_area_slug  text,
  p_habilitar  boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plano text; v_vertical text; v_multi boolean; v_planos text[];
  v_existe_active boolean; v_reativou int;
BEGIN
  -- Pilar 2: guard admin obrigatorio antes de gravar
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissao para habilitar areas' USING ERRCODE='42501';
  END IF;

  SELECT plano_principal_id INTO v_plano
  FROM area_menu_config WHERE area_slug = p_area_slug AND ativo;
  IF v_plano IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'area sem plano principal: ' || p_area_slug);
  END IF;

  SELECT vertical INTO v_vertical FROM plan_catalog WHERE id = v_plano;

  -- multi: vertical com mais de uma area (ex.: custeio = Sub-A + Sub-B)
  -- nesse caso, opera so no plano principal da area solicitada
  SELECT count(*) > 1 INTO v_multi
  FROM area_menu_config amc JOIN plan_catalog p ON p.id = amc.plano_principal_id
  WHERE p.vertical = v_vertical AND amc.plano_principal_id IS NOT NULL AND amc.ativo;

  IF v_multi THEN
    v_planos := ARRAY[v_plano];
  ELSE
    SELECT array_agg(id) INTO v_planos FROM plan_catalog WHERE vertical = v_vertical;
  END IF;

  IF p_habilitar THEN
    SELECT EXISTS(
      SELECT 1 FROM tenant_subscriptions
      WHERE company_id = p_company_id AND plan_id = ANY(v_planos) AND status = 'active'
    ) INTO v_existe_active;
    IF v_existe_active THEN
      RETURN jsonb_build_object('ok', true, 'acao', 'ja_habilitada', 'area', p_area_slug);
    END IF;

    UPDATE tenant_subscriptions
    SET status = 'active', cancelled_at = NULL, updated_at = now()
    WHERE id = (
      SELECT id FROM tenant_subscriptions
      WHERE company_id = p_company_id AND plan_id = ANY(v_planos)
        AND status IN ('cancelled','pending_setup')
      ORDER BY updated_at DESC NULLS LAST LIMIT 1
    );
    GET DIAGNOSTICS v_reativou = ROW_COUNT;

    IF v_reativou = 0 THEN
      INSERT INTO tenant_subscriptions (company_id, plan_id, status)
      VALUES (p_company_id, v_plano, 'active');
    END IF;

    RETURN jsonb_build_object('ok', true, 'acao', 'habilitada', 'area', p_area_slug, 'plano', v_plano);
  ELSE
    UPDATE tenant_subscriptions
    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE company_id = p_company_id AND plan_id = ANY(v_planos) AND status = 'active';
    RETURN jsonb_build_object('ok', true, 'acao', 'desabilitada', 'area', p_area_slug);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.fn_empresa_area_toggle(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_area_toggle(uuid, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_empresa_area_toggle(uuid, text, boolean) IS
'empresa-habilitar-areas · toggle multi-flag de area · guarda is_admin().';

-- Parte 2 · status (alimenta toggles da UI)
CREATE OR REPLACE FUNCTION public.fn_empresa_areas_status(p_company_id uuid)
RETURNS TABLE(area_slug text, nome_menu text, status_comercial text, ordem int,
              habilitada boolean, plano_principal_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT amc.area_slug, amc.nome_menu, amc.status_comercial, amc.ordem,
    EXISTS(
      SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
      WHERE ts.company_id = p_company_id AND ts.status = 'active'
        AND CASE
          WHEN (SELECT count(*) > 1 FROM area_menu_config a2 JOIN plan_catalog p2 ON p2.id = a2.plano_principal_id
                WHERE p2.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id) AND a2.ativo)
            THEN ts.plan_id = amc.plano_principal_id
            ELSE p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id)
        END
    ) AS habilitada,
    amc.plano_principal_id
  FROM area_menu_config amc
  WHERE amc.ativo
  ORDER BY amc.ordem;
$$;

REVOKE ALL ON FUNCTION public.fn_empresa_areas_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresa_areas_status(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_empresa_areas_status(uuid) IS
'empresa-habilitar-areas · status atual de cada area por empresa · alimenta toggles do admin.';
