-- BLOCO 1 · VAZAMENTO: métricas comerciais da PS (clientes ativos, MRR, % evolução, status/piloto, rollout)
-- estavam saindo pro CLIENTE via fn_areas_menu_lateral (KGF via "MRR R$497 · Clientes ativos: 1 · PILOTO").
-- Blindagem NA ORIGEM: só PS_ADMIN (ou role adm/acesso_total) recebe esses campos; demais recebem NULL.
-- NÃO muda a visibilidade das áreas (visivel usa a.status_comercial internamente) — só oculta o dado comercial
-- do payload, pra não vazar nem na resposta da rede. Consumidor único: AreaRootPlaceholder (reescrito).
-- Prova (autenticado): não-PS → clientes=0/mrr=0/status=NULL; PS → clientes=27/mrr=5669.
CREATE OR REPLACE FUNCTION public.fn_areas_menu_lateral(p_user_id uuid DEFAULT NULL::uuid, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id text, ordem integer, nome_menu text, icone text, rota_raiz text, cor_destaque text, status_comercial text, status_badge_label text, status_badge_color text, clientes_ativos integer, mrr_brl numeric, pct_evolucao integer, meta_pct integer, estrategia_rollout text, visivel boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_areas_allowed TEXT[] := NULL;
  v_user_role TEXT;
  v_is_admin BOOLEAN := false;
  v_is_ps BOOLEAN := false;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NOT NULL THEN
    SELECT uaa.areas_allowed INTO v_areas_allowed
    FROM user_areas_allowed uaa
    WHERE uaa.user_id = v_user_id AND uaa.restricted = true
      AND (uaa.expires_at IS NULL OR uaa.expires_at > NOW())
      AND array_length(uaa.areas_allowed, 1) > 0;

    SELECT LOWER(COALESCE(u.role, '')) INTO v_user_role FROM users u WHERE u.id = v_user_id;
    v_is_admin := v_user_role IN ('adm', 'admin', 'acesso_total');
    -- PS = equipe interna (system_role PS_ADMIN ou admin de sistema). Só ela vê métrica comercial.
    v_is_ps := v_is_admin OR EXISTS (SELECT 1 FROM users u WHERE u.id=v_user_id AND u.system_role='PS_ADMIN');
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.ordem, a.nome_menu, a.icone, a.rota_raiz, a.cor_destaque,
    CASE WHEN v_is_ps THEN a.status_comercial ELSE NULL END,
    CASE WHEN v_is_ps THEN (CASE a.status_comercial
      WHEN 'em_producao' THEN 'Em produção' WHEN 'piloto' THEN 'Piloto'
      WHEN 'em_construcao' THEN 'Em construção' WHEN 'futuro' THEN 'Futuro' WHEN 'backlog' THEN 'Backlog' END) ELSE NULL END,
    CASE WHEN v_is_ps THEN (CASE a.status_comercial
      WHEN 'em_producao' THEN '#10b981' WHEN 'piloto' THEN '#C8941A'
      WHEN 'em_construcao' THEN '#3D2314' WHEN 'futuro' THEN '#94a3b8' WHEN 'backlog' THEN '#94a3b8' END) ELSE NULL END,
    CASE WHEN v_is_ps THEN COALESCE((
      SELECT COUNT(*)::int FROM tenant_subscriptions ts
      JOIN plan_catalog pc ON pc.id = ts.plan_id
      WHERE ts.status = 'active' AND pc.legacy = false
        AND ((a.id NOT IN ('custeio_a','custeio_b') AND pc.vertical = a.id)
          OR (a.id = 'custeio_a' AND pc.id LIKE 'v15_custeio_a%')
          OR (a.id = 'custeio_b' AND pc.id LIKE 'v15_custeio_b%'))), 0) ELSE NULL END,
    CASE WHEN v_is_ps THEN COALESCE((
      SELECT SUM(ts.monthly_price_brl) FROM tenant_subscriptions ts
      JOIN plan_catalog pc ON pc.id = ts.plan_id
      WHERE ts.status = 'active' AND pc.legacy = false
        AND ((a.id NOT IN ('custeio_a','custeio_b') AND pc.vertical = a.id)
          OR (a.id = 'custeio_a' AND pc.id LIKE 'v15_custeio_a%')
          OR (a.id = 'custeio_b' AND pc.id LIKE 'v15_custeio_b%'))), 0) ELSE NULL END,
    CASE WHEN v_is_ps THEN a.pct_evolucao_atual ELSE NULL END,
    CASE WHEN v_is_ps THEN a.meta_pct_pronto ELSE NULL END,
    CASE WHEN v_is_ps THEN a.estrategia_rollout ELSE NULL END,
    (
      a.ativo AND a.visivel_sempre
      AND (v_areas_allowed IS NULL OR a.id = ANY(v_areas_allowed))
      AND (
        v_is_admin OR p_company_id IS NULL
        OR a.status_comercial NOT IN ('piloto', 'em_producao')
        OR EXISTS (
          SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog pc ON pc.id = ts.plan_id
          WHERE ts.company_id = p_company_id AND ts.status = 'active' AND pc.legacy = false
            AND ((a.id NOT IN ('custeio_a','custeio_b') AND pc.vertical = a.id)
              OR (a.id = 'custeio_a' AND pc.id LIKE 'v15_custeio_a%')
              OR (a.id = 'custeio_b' AND pc.id LIKE 'v15_custeio_b%')))
      )
    )
  FROM area_menu_config a
  WHERE a.ativo = true
    AND (v_areas_allowed IS NULL OR a.id = ANY(v_areas_allowed))
  ORDER BY a.ordem;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_areas_menu_lateral(uuid,uuid) TO authenticated;
