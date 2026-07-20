-- ORDEM DE MENU POR ÁREA (aditivo, autorizado pelo CEO). RD-53: provado que, sem override, a saída da
-- RPC é IDÊNTICA (0 divergências em 40 combos: Frioeste/KGF/PS Gestão/Tryo × 10 áreas). NUNCA toca o
-- secao_ordem global — só adiciona um override OPCIONAL por área. As demais áreas seguem inalteradas.

-- 1 · tabela de override (vazia = comportamento de hoje)
CREATE TABLE IF NOT EXISTS public.area_secao_ordem (
  area_slug text NOT NULL,
  secao text NOT NULL,
  ordem integer NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (area_slug, secao)
);

-- 2 · RPC: única mudança vs a versão anterior é o ORDER BY final —
--     COALESCE(override_da_area, secao_ordem_global). Todo o resto é idêntico.
CREATE OR REPLACE FUNCTION public.fn_modulos_sidebar_por_area(p_area_id text, p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(secao text, secao_label text, modulo_id text, nome text, rota text, icone text, ordem integer, status text, badge_label text, badge_color text, diferencial boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_role text;
  v_user_nivel text;
  v_aplicar_filtro_empresa boolean;
  v_aplicar_filtro_nivel boolean;
BEGIN
  p_user_id := COALESCE(p_user_id, auth.uid());
  v_aplicar_filtro_empresa := (p_company_id IS NOT NULL);
  v_aplicar_filtro_nivel := (p_user_id IS NOT NULL);

  IF p_user_id IS NOT NULL AND p_area_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id AND uaa.restricted = true)
     AND NOT EXISTS (SELECT 1 FROM user_areas_allowed uaa WHERE uaa.user_id = p_user_id AND uaa.restricted = true AND p_area_id = ANY(uaa.areas_allowed))
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.system_role IS NOT NULL)
  THEN
    RETURN;
  END IF;

  IF v_aplicar_filtro_nivel THEN
    SELECT u.role INTO v_user_role FROM users u WHERE u.id = p_user_id;
    v_user_nivel := CASE LOWER(COALESCE(v_user_role, ''))
      WHEN 'adm' THEN 'administrador' WHEN 'admin' THEN 'administrador'
      WHEN 'acesso_total' THEN 'administrador' WHEN 'socio' THEN 'socio'
      WHEN 'sócio' THEN 'socio' WHEN 'diretor' THEN 'diretor'
      WHEN 'gerente' THEN 'gerente' WHEN 'comercial' THEN 'comercial'
      WHEN 'financeiro' THEN 'financeiro' WHEN 'consultor' THEN 'consultor'
      WHEN 'contador' THEN 'contador_admin' WHEN 'coordenador' THEN 'coordenador'
      WHEN 'operacional' THEN 'operacional' WHEN 'supervisor' THEN 'supervisor'
      WHEN 'cliente_bpo' THEN 'cliente_bpo' WHEN 'cliente_wealth' THEN 'cliente_wealth'
      ELSE 'administrador'
    END;
  END IF;

  RETURN QUERY
  WITH
  modulos_pagos_empresa AS (
    SELECT DISTINCT pm.module_id
    FROM tenant_subscriptions ts
    JOIN plan_catalog pc ON pc.id = ts.plan_id
    JOIN plan_modules pm ON pm.plan_id = pc.id
    WHERE ts.status = 'active' AND pc.ativo = true AND ts.company_id = p_company_id
  ),
  todos AS (
    SELECT
      COALESCE(UPPER(mc.subgrupo), 'AREA')::text AS secao,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 'INÍCIO'
        WHEN mc.subgrupo = 'financeiro' THEN 'FINANCEIRO'
        WHEN mc.subgrupo = 'contratos_vendas' THEN 'CONTRATOS & VENDAS'
        WHEN mc.subgrupo = 'analises' THEN 'ANÁLISES & RELATÓRIOS'
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 'INTELIGÊNCIA & PROTEÇÃO'
        WHEN mc.subgrupo = 'cadastros' THEN 'CADASTROS'
        WHEN mc.subgrupo = 'administracao' THEN 'ADMINISTRAÇÃO'
        WHEN mc.subgrupo = 'docs_regulatorios' THEN 'DOCUMENTOS REGULATORIOS'
        WHEN mc.subgrupo = 'controle_epis' THEN 'CONTROLE DE EPIs'
        WHEN mc.subgrupo = 'producao_marketing' THEN 'PRODUCAO E MARKETING'
        WHEN mc.subgrupo = 'financeiro_recorrente' THEN 'FINANCEIRO RECORRENTE'
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 'FINANCEIRO UNIFICADO'
        WHEN mc.subgrupo = 'visao_executiva' THEN 'VISAO EXECUTIVA'
        WHEN mc.subgrupo = 'crm_atendimento' THEN 'CRM E ATENDIMENTO'
        WHEN mc.subgrupo = 'vendas_propostas' THEN 'VENDAS E PROPOSTAS'
        WHEN mc.subgrupo = 'incidentes_riscos' THEN 'INCIDENTES E RISCOS'
        WHEN mc.subgrupo = 'quimicos_ambiente' THEN 'QUIMICOS E AMBIENTE'
        WHEN mc.subgrupo = 'saude_ocupacional' THEN 'SAUDE OCUPACIONAL'
        WHEN mc.subgrupo = 'compliance_legal' THEN 'COMPLIANCE LEGAL'
        WHEN mc.subgrupo = 'campo_mobile' THEN 'CAMPO MOBILE'
        WHEN mc.subgrupo IS NULL THEN UPPER(a.nome_menu)
        ELSE REPLACE(UPPER(mc.subgrupo), '_', ' ')
      END::text AS secao_label,
      mc.id AS modulo_id, mc.nome,
      CASE
        WHEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', '')) IS NULL THEN NULL
        WHEN p_area_id IS NULL OR p_area_id = '' THEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', ''))
        ELSE (CASE
          WHEN COALESCE(mc.rota, a.rota_raiz) LIKE '%?area=%' OR COALESCE(mc.rota, a.rota_raiz) LIKE '%&area=%'
            THEN COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', ''))
          WHEN COALESCE(mc.rota, '') LIKE '%#%' THEN
            SPLIT_PART(mc.rota, '#', 1)
            || (CASE WHEN SPLIT_PART(mc.rota, '#', 1) LIKE '%?%' THEN '&' ELSE '?' END)
            || 'area=' || p_area_id || '#' || SPLIT_PART(mc.rota, '#', 2)
          WHEN COALESCE(mc.rota, '') LIKE '%?%' THEN mc.rota || '&area=' || p_area_id
          ELSE COALESCE(mc.rota, a.rota_raiz || '/' || replace(mc.id, a.id || '_', '')) || '?area=' || p_area_id
        END)
      END AS rota,
      COALESCE(mc.icone, 'Box') AS icone, mc.ordem,
      COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto') AS status,
      CASE COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto')
        WHEN 'pronto' THEN 'Pronto' WHEN 'parcial' THEN 'Parcial'
        WHEN 'em_construcao' THEN 'Em construção' WHEN 'previsto' THEN 'Previsto'
      END AS badge_label,
      CASE COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto')
        WHEN 'pronto' THEN '#10b981' WHEN 'parcial' THEN '#C8941A'
        WHEN 'em_construcao' THEN '#3D2314' WHEN 'previsto' THEN '#94a3b8'
      END AS badge_color,
      COALESCE(mc.diferencial, false) AS diferencial,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 0
        WHEN mc.subgrupo = 'financeiro' THEN 1
        WHEN mc.subgrupo = 'contratos_vendas' THEN 2
        WHEN mc.subgrupo = 'analises' THEN 3
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 4
        WHEN mc.subgrupo = 'cadastros' THEN 5
        WHEN mc.subgrupo = 'administracao' THEN 9
        WHEN mc.subgrupo = 'visao_executiva' THEN 0
        WHEN mc.subgrupo = 'docs_regulatorios' THEN 1
        WHEN mc.subgrupo = 'producao_marketing' THEN 1
        WHEN mc.subgrupo = 'controle_epis' THEN 2
        WHEN mc.subgrupo = 'financeiro_recorrente' THEN 2
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 3
        WHEN mc.subgrupo = 'vendas_propostas' THEN 4
        WHEN mc.subgrupo = 'crm_atendimento' THEN 5
        WHEN mc.subgrupo IS NOT NULL THEN 6
        ELSE 10
      END AS secao_ordem
    FROM module_catalog mc
    CROSS JOIN area_menu_config a
    WHERE mc.ativo = true AND mc.legacy = false
      AND mc.grupo = p_area_id AND a.id = p_area_id
      AND p_area_id IS NOT NULL
      AND (NOT v_aplicar_filtro_empresa OR mc.id IN (SELECT module_id FROM modulos_pagos_empresa))

    UNION ALL

    SELECT
      COALESCE(UPPER(mc.subgrupo), 'COMPARTILHADO')::text AS secao,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 'INÍCIO'
        WHEN mc.subgrupo = 'financeiro' THEN 'FINANCEIRO'
        WHEN mc.subgrupo = 'contratos_vendas' THEN 'CONTRATOS & VENDAS'
        WHEN mc.subgrupo = 'analises' THEN 'ANÁLISES & RELATÓRIOS'
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 'INTELIGÊNCIA & PROTEÇÃO'
        WHEN mc.subgrupo = 'cadastros' THEN 'CADASTROS'
        WHEN mc.subgrupo = 'administracao' THEN 'ADMINISTRAÇÃO'
        WHEN mc.subgrupo = 'financeiro_recorrente' THEN 'FINANCEIRO RECORRENTE'
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 'FINANCEIRO UNIFICADO'
        WHEN mc.subgrupo = 'visao_executiva' THEN 'VISAO EXECUTIVA'
        WHEN mc.subgrupo = 'crm_atendimento' THEN 'CRM E ATENDIMENTO'
        WHEN mc.subgrupo = 'vendas_propostas' THEN 'VENDAS E PROPOSTAS'
        WHEN mc.subgrupo IS NULL THEN 'COMPARTILHADO'
        ELSE REPLACE(UPPER(mc.subgrupo), '_', ' ')
      END::text AS secao_label,
      mc.id AS modulo_id, mc.nome,
      CASE
        WHEN mc.rota IS NULL THEN NULL
        WHEN p_area_id IS NULL OR p_area_id = '' THEN mc.rota
        WHEN mc.rota LIKE '%?area=%' OR mc.rota LIKE '%&area=%' THEN mc.rota
        WHEN mc.rota LIKE '%#%' THEN
          SPLIT_PART(mc.rota, '#', 1)
          || (CASE WHEN SPLIT_PART(mc.rota, '#', 1) LIKE '%?%' THEN '&' ELSE '?' END)
          || 'area=' || p_area_id || '#' || SPLIT_PART(mc.rota, '#', 2)
        WHEN mc.rota LIKE '%?%' THEN mc.rota || '&area=' || p_area_id
        ELSE mc.rota || '?area=' || p_area_id
      END AS rota,
      COALESCE(mc.icone, 'Box') AS icone, mc.ordem,
      COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto') AS status,
      CASE COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto')
        WHEN 'pronto' THEN 'Pronto' WHEN 'parcial' THEN 'Parcial'
        WHEN 'em_construcao' THEN 'Em construção' WHEN 'previsto' THEN 'Previsto'
      END AS badge_label,
      CASE COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1), 'previsto')
        WHEN 'pronto' THEN '#10b981' WHEN 'parcial' THEN '#C8941A'
        WHEN 'em_construcao' THEN '#3D2314' WHEN 'previsto' THEN '#94a3b8'
      END AS badge_color,
      COALESCE(mc.diferencial, false) AS diferencial,
      CASE
        WHEN mc.subgrupo = 'inicio' THEN 0
        WHEN mc.subgrupo = 'financeiro' THEN 1
        WHEN mc.subgrupo = 'contratos_vendas' THEN 2
        WHEN mc.subgrupo = 'analises' THEN 3
        WHEN mc.subgrupo = 'inteligencia_protecao' THEN 4
        WHEN mc.subgrupo = 'cadastros' THEN 5
        WHEN mc.subgrupo = 'administracao' THEN 9
        WHEN mc.subgrupo = 'visao_executiva' THEN 0
        WHEN mc.subgrupo = 'financeiro_recorrente' THEN 2
        WHEN mc.subgrupo = 'financeiro_unificado' THEN 3
        WHEN mc.subgrupo = 'vendas_propostas' THEN 4
        WHEN mc.subgrupo = 'crm_atendimento' THEN 5
        ELSE 7
      END AS secao_ordem
    FROM module_catalog mc
    WHERE mc.ativo = true AND mc.legacy = false
      AND mc.is_shared = true
      AND mc.surface_in_groups @> ARRAY[p_area_id]::text[]
      AND mc.grupo != p_area_id
      AND p_area_id IS NOT NULL
  )
  SELECT t.secao, t.secao_label, t.modulo_id, t.nome, t.rota, t.icone,
         t.ordem, t.status, t.badge_label, t.badge_color, t.diferencial
  FROM todos t
  WHERE (NOT v_aplicar_filtro_nivel OR NOT EXISTS (
    SELECT 1 FROM permissoes_nivel pn
    WHERE pn.modulo_id = t.modulo_id
      AND pn.nivel = v_user_nivel
      AND pn.pode_ver = false
  ))
  ORDER BY COALESCE((SELECT aso.ordem FROM area_secao_ordem aso
                     WHERE aso.area_slug = p_area_id AND aso.secao = t.secao AND aso.ativo = true),
                    t.secao_ordem), t.ordem;
END $function$;

-- 3 · override SÓ da área industrial: Início → Operação(Ponto) → Abastecimento → Indústria → Inteligência(BI) → Administração.
INSERT INTO public.area_secao_ordem (area_slug, secao, ordem) VALUES
  ('industrial','INICIO',0),
  ('industrial','OPERACAO',1),
  ('industrial','ABASTECIMENTO',2),
  ('industrial','AREA',3),
  ('industrial','INTELIGENCIA_BI',4),
  ('industrial','ADMINISTRACAO',9)
ON CONFLICT (area_slug, secao) DO UPDATE SET ordem=EXCLUDED.ordem, ativo=true;
