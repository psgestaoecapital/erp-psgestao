-- FIX filtro de áreas: a fn_listar_areas_visiveis FALHAVA ABERTA quando não identificava o usuário.
-- Matriz medida (Frioeste): (company, rh)=2 · (null, rh)=2 · (null, null)=13 [todas as áreas]. Com usuário a
-- restrição per-user (user_areas_allowed.restricted) sempre aplica; SEM usuário ela era pulada e, com
-- company nula (consolidado/carregando), o entitlement abria tudo → vazavam Oficina/Hub/PM/BPO p/ um
-- usuário restrito. RD-51/segurança: um filtro de permissão nunca pode falhar aberto.
-- Fix: se, após COALESCE(p_user_id, auth.uid()), o usuário continuar NULL (chamada não autenticada),
-- RETORNA VAZIO (fail-closed). Chamadas autenticadas (browser com JWT) não mudam — auth.uid() preenche.

CREATE OR REPLACE FUNCTION public.fn_listar_areas_visiveis(p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ordem integer, area_slug text, nome_menu text, icone text, rota_raiz text, descricao_curta text, status_comercial text, cor_destaque text, empresa_tem_acesso boolean, motivo_acesso text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_restrito boolean := false;
  v_areas text[];
  v_super boolean := false;
BEGIN
  p_user_id := COALESCE(p_user_id, auth.uid());

  -- fail-closed: sem usuário identificado, não devolve área nenhuma (antes: devolvia todas).
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT uaa.restricted, uaa.areas_allowed INTO v_restrito, v_areas
  FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id;
  SELECT (u.system_role = 'PS_ADMIN') INTO v_super FROM users u WHERE u.id = p_user_id;

  RETURN QUERY
  SELECT amc.ordem::int, amc.area_slug, amc.nome_menu, amc.icone, amc.rota_raiz,
    COALESCE(amc.descricao_curta, '') AS descricao_curta, amc.status_comercial, amc.cor_destaque,
    ( p_company_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
        WHERE ts.company_id = p_company_id AND ts.status = 'active'
          AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id)
    ) ) AS empresa_tem_acesso,
    CASE
      WHEN p_company_id IS NULL THEN 'sem_empresa'
      WHEN amc.area_slug = 'gestao_empresarial' THEN 'base_universal'
      WHEN EXISTS (
        SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
        WHERE ts.company_id = p_company_id AND ts.status = 'active'
          AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id)
      ) THEN 'contratada'
      WHEN COALESCE(v_super, false) THEN 'super_admin'
      ELSE 'nao_contratada'
    END AS motivo_acesso
  FROM area_menu_config amc
  WHERE amc.ativo
    AND (
      COALESCE(v_super, false)
      OR p_company_id IS NULL
      OR amc.area_slug = 'gestao_empresarial'
      OR EXISTS (SELECT 1 FROM tenant_subscriptions ts JOIN plan_catalog p ON p.id = ts.plan_id
                 WHERE ts.company_id = p_company_id AND ts.status = 'active'
                   AND p.vertical = (SELECT vertical FROM plan_catalog WHERE id = amc.plano_principal_id))
    )
    AND ( COALESCE(v_super, false)
          OR NOT COALESCE(v_restrito, false)
          OR amc.area_slug = ANY(COALESCE(v_areas, ARRAY[]::text[])) )
  ORDER BY amc.ordem;
END;
$function$;
