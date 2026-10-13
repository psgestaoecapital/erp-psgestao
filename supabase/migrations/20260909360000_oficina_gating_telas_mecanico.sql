-- ============================================================
-- Oficina · Wave gating de telas · esconder do mecanico as telas que nao sao dele
-- SPEC "Oficina · Papeis do dono e do mecanico" (09/09) §3.2. Decisao do CEO: gating de telas
-- ANTES do B.3 (adicionar mecanico antes de esconder as telas criaria usuario que ve o que nao deveria).
--
-- Mudanca MINIMA e add-only em fn_modulos_sidebar_por_area: uma clausula WHERE que exclui, para
-- OFICINA_MECANICO nesta empresa, os 3 modulos da area oficina que sao dele NAO ver:
--   - oficina_aprovacao_cliente (Aprovacao do Cliente — onde o preco e decidido)
--   - oficina_comissao          (Comissao Mecanico — valor; O1 so a propria, ainda sem identidade)
--   - oficina_whatsapp_ia       (WhatsApp IA Cliente)
-- (O "Financeiro (GE)" e outra AREA — governado por visibilidade de area, nao por esta funcao.)
--
-- Por que aqui e nao no permissoes_nivel: aquele mecanismo keia em fn_role_to_nivel(users.role)
-- (nivel GLOBAL), e OFICINA_MECANICO e tenant_user_roles.role (papel POR EMPRESA). A clausula nova
-- consulta tenant_user_roles por p_user_id + p_company_id. Para qualquer outro papel/area: no-op.
--
-- NOTA (mesma familia do write-path, erp_contexto_projeto ed034e56): o lugar definitivo desta
-- decisao e a Fase 3 (fn_acesso_efetivo decide, telas e writes consultam). Este e o gating
-- targeted da oficina ate la — add-only, reversivel.
--
-- Prova (rollback via RAISE, regressao): dono ve IDENTICO ao de antes; mecanico ve o mesmo menos
-- os 3 modulos; outra area/papel intactos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_modulos_sidebar_por_area(p_area_id text, p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(secao text, secao_label text, modulo_id text, nome text, rota text, icone text, ordem integer, status text, badge_label text, badge_color text, diferencial boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_role text; v_user_nivel text;
  v_aplicar_filtro_empresa boolean; v_aplicar_filtro_nivel boolean;
  v_ramos text[];
BEGIN
  p_user_id := COALESCE(p_user_id, auth.uid());
  v_aplicar_filtro_empresa := (p_company_id IS NOT NULL);
  v_aplicar_filtro_nivel := (p_user_id IS NOT NULL);
  v_ramos := public.ramos_da_empresa(p_company_id);

  IF p_user_id IS NOT NULL AND p_area_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id AND uaa.restricted = true)
     AND NOT EXISTS (SELECT 1 FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id AND uaa.restricted = true AND p_area_id = ANY(uaa.areas_allowed))
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.system_role IS NOT NULL)
  THEN RETURN; END IF;

  IF v_aplicar_filtro_nivel THEN
    SELECT u.role INTO v_user_role FROM users u WHERE u.id = p_user_id;
    v_user_nivel := public.fn_role_to_nivel(v_user_role);
  END IF;

  RETURN QUERY
  WITH
  modulos_pagos_empresa AS (
    SELECT DISTINCT pm.module_id FROM tenant_subscriptions ts
    JOIN plan_catalog pc ON pc.id = ts.plan_id JOIN plan_modules pm ON pm.plan_id = pc.id
    WHERE ts.status = 'active' AND pc.ativo = true AND ts.company_id = p_company_id
  ),
  todos AS (
    SELECT
      COALESCE(UPPER(mc.subgrupo), 'AREA')::text AS secao,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 'INÍCIO' WHEN mc.subgrupo = 'financeiro' THEN 'FINANCEIRO'
        WHEN mc.subgrupo = 'contratos_vendas' THEN 'CONTRATOS & VENDAS' WHEN mc.subgrupo = 'analises' THEN 'ANÁLISES & RELATÓRIOS'
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 'INTELIGÊNCIA & PROTEÇÃO' WHEN mc.subgrupo = 'cadastros' THEN 'CADASTROS'
        WHEN mc.subgrupo = 'administracao' THEN 'ADMINISTRAÇÃO' WHEN mc.subgrupo = 'docs_regulatorios' THEN 'DOCUMENTOS REGULATORIOS'
        WHEN mc.subgrupo = 'controle_epis' THEN 'CONTROLE DE EPIs' WHEN mc.subgrupo = 'producao_marketing' THEN 'PRODUCAO E MARKETING'
        WHEN mc.subgrupo = 'financeiro_recorrente' THEN 'FINANCEIRO RECORRENTE' WHEN mc.subgrupo = 'financeiro_unificado' THEN 'FINANCEIRO UNIFICADO'
        WHEN mc.subgrupo = 'visao_executiva' THEN 'VISAO EXECUTIVA' WHEN mc.subgrupo = 'crm_atendimento' THEN 'CRM E ATENDIMENTO'
        WHEN mc.subgrupo = 'vendas_propostas' THEN 'VENDAS E PROPOSTAS' WHEN mc.subgrupo = 'incidentes_riscos' THEN 'INCIDENTES E RISCOS'
        WHEN mc.subgrupo = 'quimicos_ambiente' THEN 'QUIMICOS E AMBIENTE' WHEN mc.subgrupo = 'saude_ocupacional' THEN 'SAUDE OCUPACIONAL'
        WHEN mc.subgrupo = 'compliance_legal' THEN 'COMPLIANCE LEGAL' WHEN mc.subgrupo = 'campo_mobile' THEN 'CAMPO MOBILE'
        WHEN mc.subgrupo IS NULL THEN UPPER(a.nome_menu) ELSE REPLACE(UPPER(mc.subgrupo), '_', ' ')
      END::text AS secao_label,
      mc.id AS modulo_id, mc.nome,
      CASE
        WHEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', '')) IS NULL THEN NULL
        WHEN p_area_id IS NULL OR p_area_id = '' THEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', ''))
        ELSE (CASE
          WHEN COALESCE(mc.rota, a.rota_raiz) LIKE '%?area=%' OR COALESCE(mc.rota, a.rota_raiz) LIKE '%&area=%'
            THEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', ''))
          WHEN COALESCE(mc.rota, '') LIKE '%#%' THEN SPLIT_PART(mc.rota, '#', 1)
            || (CASE WHEN SPLIT_PART(mc.rota, '#', 1) LIKE '%?%' THEN '&' ELSE '?' END) || 'area=' || p_area_id || '#' || SPLIT_PART(mc.rota, '#', 2)
          WHEN COALESCE(mc.rota, '') LIKE '%?%' THEN mc.rota || '&area=' || p_area_id
          ELSE COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', '')) || '?area=' || p_area_id
        END)
      END AS rota,
      COALESCE(mc.icone, 'Box') AS icone, mc.ordem,
      COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL) AS status,
      CASE COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL)
        WHEN 'pronto' THEN 'Pronto' WHEN 'parcial' THEN 'Parcial' WHEN 'em_construcao' THEN 'Em construção' WHEN 'previsto' THEN 'Previsto' END AS badge_label,
      CASE COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL)
        WHEN 'pronto' THEN '#10b981' WHEN 'parcial' THEN '#C8941A' WHEN 'em_construcao' THEN '#3D2314' WHEN 'previsto' THEN '#94a3b8' END AS badge_color,
      COALESCE(mc.diferencial, false) AS diferencial,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 0 WHEN mc.subgrupo = 'financeiro' THEN 1 WHEN mc.subgrupo = 'contratos_vendas' THEN 2
        WHEN mc.subgrupo = 'analises' THEN 3 WHEN mc.subgrupo = 'inteligencia_protecao' THEN 4 WHEN mc.subgrupo = 'cadastros' THEN 5
        WHEN mc.subgrupo = 'administracao' THEN 9 WHEN mc.subgrupo = 'visao_executiva' THEN 0 WHEN mc.subgrupo = 'docs_regulatorios' THEN 1
        WHEN mc.subgrupo = 'producao_marketing' THEN 1 WHEN mc.subgrupo = 'controle_epis' THEN 2 WHEN mc.subgrupo = 'financeiro_recorrente' THEN 2
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 3 WHEN mc.subgrupo = 'vendas_propostas' THEN 4 WHEN mc.subgrupo = 'crm_atendimento' THEN 5
        WHEN mc.subgrupo IS NOT NULL THEN 6 ELSE 10 END AS secao_ordem
    FROM module_catalog mc CROSS JOIN area_menu_config a
    WHERE mc.ativo = true AND mc.legacy = false AND mc.grupo = p_area_id AND a.id = p_area_id AND p_area_id IS NOT NULL
      AND (NOT v_aplicar_filtro_empresa OR mc.id IN (SELECT module_id FROM modulos_pagos_empresa))
      AND (NOT v_aplicar_filtro_empresa OR mc.ramos_aplicaveis IS NULL OR cardinality(mc.ramos_aplicaveis) = 0 OR mc.ramos_aplicaveis && v_ramos)

    UNION ALL

    SELECT
      COALESCE(UPPER(mc.subgrupo), 'COMPARTILHADO')::text AS secao,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 'INÍCIO' WHEN mc.subgrupo = 'financeiro' THEN 'FINANCEIRO'
        WHEN mc.subgrupo = 'contratos_vendas' THEN 'CONTRATOS & VENDAS' WHEN mc.subgrupo = 'analises' THEN 'ANÁLISES & RELATÓRIOS'
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 'INTELIGÊNCIA & PROTEÇÃO' WHEN mc.subgrupo = 'cadastros' THEN 'CADASTROS'
        WHEN mc.subgrupo = 'administracao' THEN 'ADMINISTRAÇÃO' WHEN mc.subgrupo = 'financeiro_recorrente' THEN 'FINANCEIRO RECORRENTE'
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 'FINANCEIRO UNIFICADO' WHEN mc.subgrupo = 'visao_executiva' THEN 'VISAO EXECUTIVA'
        WHEN mc.subgrupo = 'crm_atendimento' THEN 'CRM E ATENDIMENTO' WHEN mc.subgrupo = 'vendas_propostas' THEN 'VENDAS E PROPOSTAS'
        WHEN mc.subgrupo IS NULL THEN 'COMPARTILHADO' ELSE REPLACE(UPPER(mc.subgrupo), '_', ' ')
      END::text AS secao_label,
      mc.id AS modulo_id, mc.nome,
      CASE
        WHEN mc.rota IS NULL THEN NULL WHEN p_area_id IS NULL OR p_area_id = '' THEN mc.rota
        WHEN mc.rota LIKE '%?area=%' OR mc.rota LIKE '%&area=%' THEN mc.rota
        WHEN mc.rota LIKE '%#%' THEN SPLIT_PART(mc.rota, '#', 1)
          || (CASE WHEN SPLIT_PART(mc.rota, '#', 1) LIKE '%?%' THEN '&' ELSE '?' END) || 'area=' || p_area_id || '#' || SPLIT_PART(mc.rota, '#', 2)
        WHEN mc.rota LIKE '%?%' THEN mc.rota || '&area=' || p_area_id ELSE mc.rota || '?area=' || p_area_id
      END AS rota,
      COALESCE(mc.icone, 'Box') AS icone, mc.ordem,
      COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL) AS status,
      CASE COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL)
        WHEN 'pronto' THEN 'Pronto' WHEN 'parcial' THEN 'Parcial' WHEN 'em_construcao' THEN 'Em construção' WHEN 'previsto' THEN 'Previsto' END AS badge_label,
      CASE COALESCE((SELECT CASE WHEN count(*)=0 THEN NULL WHEN count(*) FILTER (WHERE fc.status='pronto')=count(*) THEN 'pronto' WHEN count(*) FILTER (WHERE fc.status IN ('pronto','parcial','em_construcao'))>0 THEN 'parcial' ELSE 'previsto' END FROM feature_catalog fc WHERE fc.module_id = mc.id), NULL)
        WHEN 'pronto' THEN '#10b981' WHEN 'parcial' THEN '#C8941A' WHEN 'em_construcao' THEN '#3D2314' WHEN 'previsto' THEN '#94a3b8' END AS badge_color,
      COALESCE(mc.diferencial, false) AS diferencial,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 0 WHEN mc.subgrupo = 'financeiro' THEN 1 WHEN mc.subgrupo = 'contratos_vendas' THEN 2
        WHEN mc.subgrupo = 'analises' THEN 3 WHEN mc.subgrupo = 'inteligencia_protecao' THEN 4 WHEN mc.subgrupo = 'cadastros' THEN 5
        WHEN mc.subgrupo = 'administracao' THEN 9 WHEN mc.subgrupo = 'visao_executiva' THEN 0 WHEN mc.subgrupo = 'financeiro_recorrente' THEN 2
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 3 WHEN mc.subgrupo = 'vendas_propostas' THEN 4 WHEN mc.subgrupo = 'crm_atendimento' THEN 5
        ELSE 7 END AS secao_ordem
    FROM module_catalog mc
    WHERE mc.ativo = true AND mc.legacy = false AND mc.is_shared = true
      AND mc.surface_in_groups @> ARRAY[p_area_id]::text[] AND mc.grupo != p_area_id AND p_area_id IS NOT NULL
      AND (NOT v_aplicar_filtro_empresa OR mc.ramos_aplicaveis IS NULL OR cardinality(mc.ramos_aplicaveis) = 0 OR mc.ramos_aplicaveis && v_ramos)
  )
  SELECT t.secao, t.secao_label, t.modulo_id, t.nome, t.rota, t.icone, t.ordem, t.status, t.badge_label, t.badge_color, t.diferencial
  FROM todos t
  WHERE (NOT v_aplicar_filtro_nivel OR NOT EXISTS (
    SELECT 1 FROM permissoes_nivel pn WHERE pn.modulo_id = t.modulo_id AND pn.nivel = v_user_nivel AND pn.pode_ver = false))
    -- TRAVA OFICINA_MECANICO (§3.2, add-only): esconde as telas de valor/aprovacao do mecanico
    -- desta empresa. No-op para qualquer outro papel/area (a lista de modulos e so da oficina).
    AND NOT (
      t.modulo_id IN ('oficina_aprovacao_cliente','oficina_comissao','oficina_whatsapp_ia')
      AND p_company_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM tenant_user_roles tur
                  WHERE tur.user_id = p_user_id AND tur.company_id = p_company_id
                    AND tur.role = 'OFICINA_MECANICO' AND tur.is_active = true))
  ORDER BY COALESCE((SELECT aso.ordem FROM area_secao_ordem aso WHERE aso.area_slug = p_area_id AND aso.secao = t.secao AND aso.ativo = true), t.secao_ordem), t.ordem;
END $function$;
