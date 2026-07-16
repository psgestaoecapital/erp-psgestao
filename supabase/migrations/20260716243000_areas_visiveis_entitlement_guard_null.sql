-- FIX-FORWARD (pós-#678): menu mostra SÓ o liberado por empresa, SEM colapsar quando company=NULL.
-- ============================================================================
-- Causa raiz REAL do #677 (PROVADA — não a hipótese da chamada aninhada, que retorna 13 linhas OK
-- sob authenticated): com p_company_id=NULL (consolidado, ou antes do localStorage resolver — o
-- AreaSwitcher/landing chamam assim no load), o entitlement exigia empresa → só GE sobrevivia e um
-- usuário RESTRITO não-GE ficava VAZIO → sidebar travava / "só GE".
--
-- Fix: guarda `p_company_id IS NULL` NÃO colapsa (mantém o comportamento antigo no load/consolidado);
-- o escopo por entitlement só entra quando HÁ empresa selecionada. Entitlement INLINE (sem chamada
-- aninhada — à prova de bala). Restrição per-user só ESTREITA. Super-admin = SÓ PS_ADMIN.
--
-- Régua sob role AUTHENTICATED (o caminho REAL da UI, não service_role — a lição do #677):
--   fabio@Tryo=[hub] · fabio@NULL=[hub] (NÃO vazio) · rodrigo=[GE,hub,compliance] ·
--   ivan@Estância=[agro,GE] · jordana@Gean=[GE,oficina,bpo] (agro=false) · jordana@consolidado=13.
-- Reversível: em caso de falha na TELA, revert = restaurar a definição do #678 (migração 20260716240000).
-- ============================================================================

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

  IF p_user_id IS NOT NULL THEN
    SELECT uaa.restricted, uaa.areas_allowed INTO v_restrito, v_areas
    FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id;
    SELECT (u.system_role = 'PS_ADMIN') INTO v_super FROM users u WHERE u.id = p_user_id;
  END IF;

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
      OR p_company_id IS NULL                      -- consolidado/carregando: NÃO colapsa (comportamento antigo)
      OR amc.area_slug = 'gestao_empresarial'      -- GE é base universal
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
