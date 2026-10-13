-- TRAVA ESTRUTURAL Pilar 2 / RD-45 — menu de áreas escopado pelo ENTITLEMENT da empresa
-- ============================================================================
-- Bug (auditado): o menu de áreas não escopava por empresa. A proteção dependia da restrição
-- per-user (band-aid). Um usuário sem restrição (ex.: Jordana, PS_SUPPORT/BPO) via TODAS as
-- áreas piloto como "Disponível" — Agro (vertical da Estância) incluso — em qualquer empresa.
--
-- Fix: fn_listar_areas_visiveis passa a basear a visibilidade em fn_empresa_areas_status
-- (fonte canônica de "contratado", match por plan_catalog.vertical — RD-26/RD-52):
--   áreas_visíveis = contratadas(empresa)  ∩  restrição_per_user  (∪ gestão_empresarial base)
-- Área não contratada = ESCONDIDA (não mostra Agro pra um gesso). Restrição per-user só ESTREITA.
-- Super-admin = SÓ PS_ADMIN (interno PS) vê o catálogo inteiro (roadmap); PS_SUPPORT (suporte/BPO
-- que opera empresas de cliente) é escopado por empresa como qualquer usuário — não fura Pilar 2.
--
-- Régua cross-tenant provada (ANTES→DEPOIS):
--   Estância/ivan agro+GE (mantém) · Frioeste industrial/compliance/GE · Gean/Jordana oficina/bpo/GE
--   (Agro sumiu — era o leak) · Tryo/rodrigo hub/compliance/GE · Tryo/fabio hub(restrito) ·
--   PS_ADMIN/gilberto = tudo. Zero regressão, zero vazamento.
-- Defesa em profundidade: erp_pec_* já têm RLS on (URL direto dá vazio pra Tryo).
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
  -- FIX SEGURANCA (Pilar 2): sem user_id explicito, usar o usuario autenticado.
  p_user_id := COALESCE(p_user_id, auth.uid());

  IF p_user_id IS NOT NULL THEN
    SELECT uaa.restricted, uaa.areas_allowed INTO v_restrito, v_areas
    FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id;
    -- super-admin = SÓ PS_ADMIN (interno). PS_SUPPORT NÃO fura o escopo por empresa (Pilar 2).
    SELECT (u.system_role = 'PS_ADMIN') INTO v_super FROM users u WHERE u.id = p_user_id;
  END IF;

  RETURN QUERY
  WITH ent AS (
    -- entitlement REAL da empresa (contratado) — fonte canonica unica
    SELECT s.area_slug, s.habilitada FROM fn_empresa_areas_status(p_company_id) s
  )
  SELECT amc.ordem::int, amc.area_slug, amc.nome_menu, amc.icone, amc.rota_raiz,
    COALESCE(amc.descricao_curta, '') AS descricao_curta, amc.status_comercial, amc.cor_destaque,
    COALESCE(e.habilitada, false) AS empresa_tem_acesso,
    CASE
      WHEN amc.area_slug = 'gestao_empresarial' THEN 'base_universal'
      WHEN COALESCE(e.habilitada, false) THEN 'contratada'
      WHEN COALESCE(v_super, false) THEN 'super_admin'
      ELSE 'nao_contratada'
    END AS motivo_acesso
  FROM area_menu_config amc
  LEFT JOIN ent e ON e.area_slug = amc.area_slug
  WHERE amc.ativo
    -- GARANTIA = entitlement da empresa (GE é base universal); super-admin (PS_ADMIN) vê tudo
    AND ( COALESCE(v_super, false)
          OR amc.area_slug = 'gestao_empresarial'
          OR COALESCE(e.habilitada, false) )
    -- restrição per-user apenas ESTREITA (nunca amplia)
    AND ( COALESCE(v_super, false)
          OR NOT COALESCE(v_restrito, false)
          OR amc.area_slug = ANY(COALESCE(v_areas, ARRAY[]::text[])) )
  ORDER BY amc.ordem;
END;
$function$;
