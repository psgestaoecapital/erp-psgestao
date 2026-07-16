-- REVERT #677 (regressão em produção): restaura a definição ANTERIOR de fn_listar_areas_visiveis.
-- ============================================================================
-- O hardening por entitlement (#677 · migração 20260716234500) quebrou usuários RESTRITOS na TELA:
-- a sidebar travava em "carregando" / só aparecia GE. Causa: fn_listar chamava fn_empresa_areas_status
-- ANINHADA — sob o service_role (teste MCP) passava, mas no caminho REAL da UI (usuário autenticado)
-- a chamada aninhada falhava e derrubava o fn_listar inteiro. Régua com SELECT paralelo = prova falsa.
--
-- A RLS das tabelas do Agro (erp_pec_*) já protege o DADO (ON, provado) — o que o #677 consertava era
-- cosmético (rótulo Agro no menu). Trocar cosmético por funcional não compensa → reverter.
-- Fix-forward virá em PR limpo, com régua rodando a função REAL da UI + validação na tela.
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
BEGIN
  -- FIX SEGURANCA (Pilar 2): sem user_id explicito, usar o usuario autenticado.
  p_user_id := COALESCE(p_user_id, auth.uid());

  IF p_user_id IS NOT NULL THEN
    SELECT uaa.restricted, uaa.areas_allowed INTO v_restrito, v_areas
    FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id;
    IF EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.system_role IS NOT NULL) THEN
      v_restrito := false;
    END IF;
  END IF;

  RETURN QUERY
  SELECT amc.ordem::int, amc.area_slug, amc.nome_menu, amc.icone, amc.rota_raiz,
    COALESCE(amc.descricao_curta, '') AS descricao_curta, amc.status_comercial, amc.cor_destaque,
    CASE
      WHEN p_company_id IS NULL THEN false
      WHEN amc.area_slug = 'gestao_empresarial' THEN true
      WHEN EXISTS (
        SELECT 1 FROM tenant_subscriptions ts
        WHERE ts.company_id = p_company_id AND ts.status = 'active'
          AND (
            (amc.area_slug = 'oficina' AND ts.plan_id ILIKE '%oficina%')
            OR (amc.area_slug = 'bpo' AND (ts.plan_id ILIKE '%bpo%' OR ts.observacao ILIKE '%bpo%'))
            OR (amc.area_slug = 'wealth' AND ts.plan_id ILIKE '%wealth%')
            OR (amc.area_slug = 'commerce' AND ts.plan_id ILIKE '%commerce%')
            OR (amc.area_slug = 'industrial' AND ts.plan_id ILIKE '%industrial%')
            OR (amc.area_slug = 'pm' AND (ts.plan_id ILIKE '%pm%' OR ts.plan_id ILIKE '%marketing%'))
            OR (amc.area_slug = 'hub' AND (ts.plan_id ILIKE '%hub%' OR ts.plan_id ILIKE '%construcao%' OR ts.plan_id ILIKE '%projeto%'))
            OR (amc.area_slug = 'agro' AND ts.plan_id ILIKE '%agro%')
            OR (amc.area_slug = 'compliance' AND ts.plan_id ILIKE '%compliance%')
            OR (amc.area_slug = 'custeio_a' AND ts.plan_id ILIKE '%custeio%')
          )
      ) THEN true ELSE false
    END AS empresa_tem_acesso,
    CASE
      WHEN p_company_id IS NULL THEN 'sem_empresa'
      WHEN amc.area_slug = 'gestao_empresarial' THEN 'base_universal'
      WHEN EXISTS (SELECT 1 FROM tenant_subscriptions ts WHERE ts.company_id = p_company_id AND ts.status = 'active') THEN 'tem_assinatura'
      ELSE 'sem_assinatura'
    END AS motivo_acesso
  FROM area_menu_config amc
  WHERE amc.ativo = true
    AND (NOT COALESCE(v_restrito,false) OR amc.area_slug = ANY(COALESCE(v_areas, ARRAY[]::text[])))
  ORDER BY amc.ordem;
END;
$function$;
