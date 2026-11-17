-- PS EHS · TAREFA 0 — Estrutura modular + isolamento (CEO 14/11, desenho aprovado pelo Eng. Chefe · ff1bdd4f)
--
-- Vende-se o EHS POR MÓDULO. 3 buckets independentes e combináveis:
--   pausas        → NR-36 (pausas térmicas, ponto/batidas, auditoria de batidas)
--   documentacao  → base documental/operacional que a Frioeste JÁ usa (docs exigidos, matriz,
--                   validação, funcionários, empresa, calendário, LGPD gestão, setores, prestadores,
--                   treinamentos, EPI, eSocial, SST)
--   completo      → superset (liga tudo) + as telas novas das ondas S1-S10 + as telas hoje inativas
--
-- GATE ADITIVO (NÃO decompor o v15_compliance — ele é de 8 clientes; decompor arriscaria todos):
--   - module_catalog.ehs_modulo classifica cada tela EHS num bucket (NULL = não é tela EHS gated).
--   - empresa_ehs_modulo diz o que cada empresa contratou.
--   - fn_modulos_sidebar_por_area ganha uma cláusula ESCOPADA (no-op fora do EHS) que esconde a tela
--     EHS cujo bucket a empresa não contratou. 'completo' é superset. Empresa SEM registro: vê o que
--     não é 'completo' (retrocompat) e nunca vê 'completo' (telas novas S1-S10 não vazam).
--
-- Garantia provada: Frioeste (pausas+documentacao) = EXATAMENTE as 22 telas ativas que ela vê hoje;
-- demo b0700000 (os 3) = tudo. Nenhum dado de cliente é tocado; nenhuma assinatura é alterada.

-- 1) Classificação da tela → bucket ───────────────────────────────────────────────────────────────
ALTER TABLE public.module_catalog
  ADD COLUMN IF NOT EXISTS ehs_modulo text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'module_catalog_ehs_modulo_check'
  ) THEN
    ALTER TABLE public.module_catalog
      ADD CONSTRAINT module_catalog_ehs_modulo_check
      CHECK (ehs_modulo IS NULL OR ehs_modulo IN ('pausas','documentacao','completo'));
  END IF;
END $$;

-- pausas (NR-36)
UPDATE public.module_catalog SET ehs_modulo = 'pausas'
 WHERE id IN ('compliance_pausas_tecnicas','compliance_ponto','compliance_auditorias');

-- documentacao (tudo que a Frioeste já usa, fora pausas — inclui eSocial/SST por decisão do CEO:
-- menu da Frioeste 100% idêntico)
UPDATE public.module_catalog SET ehs_modulo = 'documentacao'
 WHERE id IN (
   'compliance_documentos_exigidos','compliance_matriz_conformidade','compliance_validacao_automatica',
   'compliance_funcionarios_doc','compliance_empresa','compliance_calendar_ia','compliance_lgpd',
   'compliance_setores','compliance_prestadores','compliance_treinamentos','compliance_treinamentos_por_setor',
   'compliance_epi','compliance_epi_catalogo','compliance_epi_estoque','compliance_epi_fichas','compliance_epi_alertas',
   'compliance_whatsapp_assinatura_epi','compliance_esocial','compliance_sst');

-- completo (telas hoje inativas / futuras; as novas S1-S10 nascem 'completo' já na sua própria migration)
UPDATE public.module_catalog SET ehs_modulo = 'completo'
 WHERE id IN (
   'compliance_documentos','compliance_mobile_field_app','compliance_ai_copilot','compliance_computer_vision_epi',
   'compliance_incident_management','compliance_risk_assessment_jsa','compliance_forecast_incidentes',
   'compliance_chemical_sds','compliance_industrial_hygiene','compliance_ergonomia');

-- lgpd_meus_dados (autosserviço do colaborador, rota /dashboard/lgpd) fica NULL = NÃO gated (todos veem).

-- 2) Módulos EHS contratados por empresa ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empresa_ehs_modulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  modulo text NOT NULL CHECK (modulo IN ('pausas','documentacao','completo')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  UNIQUE (company_id, modulo)
);

ALTER TABLE public.empresa_ehs_modulo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='empresa_ehs_modulo' AND policyname='empresa_ehs_modulo_sel') THEN
    CREATE POLICY empresa_ehs_modulo_sel ON public.empresa_ehs_modulo
      FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='empresa_ehs_modulo' AND policyname='empresa_ehs_modulo_adm') THEN
    -- escrita (o que a empresa contratou) só pela equipe PS
    CREATE POLICY empresa_ehs_modulo_adm ON public.empresa_ehs_modulo
      FOR ALL TO authenticated
      USING (public.fn_eh_ps_admin()) WITH CHECK (public.fn_eh_ps_admin());
  END IF;
END $$;

REVOKE ALL ON public.empresa_ehs_modulo FROM anon;
GRANT SELECT ON public.empresa_ehs_modulo TO authenticated;
GRANT ALL ON public.empresa_ehs_modulo TO service_role;

-- 3) Seed: os 8 clientes atuais do compliance com pausas+documentacao (ninguém perde tela);
--    a demo b0700000 ganha também 'completo'. Dinâmico sobre quem assina o v15_compliance hoje.
INSERT INTO public.empresa_ehs_modulo (company_id, modulo)
SELECT DISTINCT ts.company_id, m.modulo
FROM public.tenant_subscriptions ts
CROSS JOIN (VALUES ('pausas'),('documentacao')) AS m(modulo)
WHERE ts.plan_id = 'v15_compliance' AND ts.status = 'active'
ON CONFLICT (company_id, modulo) DO NOTHING;

INSERT INTO public.empresa_ehs_modulo (company_id, modulo)
VALUES ('b0700000-0000-4000-a000-000000000005','completo')
ON CONFLICT (company_id, modulo) DO NOTHING;

-- 4) Gate no menu: cláusula aditiva e escopada no fn_modulos_sidebar_por_area ──────────────────────
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
    -- GATE PS-ONLY: módulo marcado so_ps só aparece para a equipe PS (system_role). No-op p/ so_ps=false.
    AND (
      NOT COALESCE((SELECT mc2.so_ps FROM module_catalog mc2 WHERE mc2.id = t.modulo_id), false)
      OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = p_user_id
                 AND u2.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')))
    -- GATE SO_DEMO: módulo marcado so_demo só aparece em empresa DEMO (companies.is_demo). No-op p/ so_demo=false.
    AND (
      NOT COALESCE((SELECT mc3.so_demo FROM module_catalog mc3 WHERE mc3.id = t.modulo_id), false)
      OR (p_company_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM companies c3 WHERE c3.id = p_company_id AND c3.is_demo = true)))
    -- GATE EHS POR MÓDULO CONTRATADO (Tarefa 0, CEO 14/11): tela EHS (module_catalog.ehs_modulo
    -- preenchido) só aparece se a empresa contratou aquele bucket (empresa_ehs_modulo). 'completo' é
    -- superset. Empresa SEM registro EHS: vê o que não é 'completo' (retrocompat) e nunca vê 'completo'
    -- (telas novas S1-S10 não vazam). No-op para módulo não-EHS (ehs_modulo NULL) e sem filtro de empresa.
    AND (
      (SELECT mc4.ehs_modulo FROM module_catalog mc4 WHERE mc4.id = t.modulo_id) IS NULL
      OR p_company_id IS NULL
      OR CASE
           WHEN EXISTS (SELECT 1 FROM empresa_ehs_modulo e WHERE e.company_id = p_company_id)
             THEN EXISTS (
               SELECT 1 FROM empresa_ehs_modulo e
               WHERE e.company_id = p_company_id
                 AND (e.modulo = 'completo'
                      OR e.modulo = (SELECT mc4.ehs_modulo FROM module_catalog mc4 WHERE mc4.id = t.modulo_id)))
           ELSE (SELECT mc4.ehs_modulo FROM module_catalog mc4 WHERE mc4.id = t.modulo_id) <> 'completo'
         END)
  ORDER BY COALESCE((SELECT aso.ordem FROM area_secao_ordem aso WHERE aso.area_slug = p_area_id AND aso.secao = t.secao AND aso.ativo = true), t.secao_ordem), t.ordem;
END $function$;

-- check-fn-guards: CREATE OR REPLACE de SECURITY DEFINER reafirma a ACL (idempotente).
REVOKE ALL ON FUNCTION public.fn_modulos_sidebar_por_area(text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_modulos_sidebar_por_area(text,uuid,uuid) TO authenticated, service_role;

-- 5) RPC de apoio ao guarda de rota do front: buckets EHS contratados pela empresa.
CREATE OR REPLACE FUNCTION public.fn_ehs_modulos_da_empresa(p_company_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_company_id IS NULL THEN ARRAY['pausas','documentacao']::text[]
    WHEN NOT EXISTS (SELECT 1 FROM public.empresa_ehs_modulo e WHERE e.company_id = p_company_id)
      THEN ARRAY['pausas','documentacao']::text[]   -- retrocompat: sem registro = tudo menos 'completo'
    WHEN EXISTS (SELECT 1 FROM public.empresa_ehs_modulo e WHERE e.company_id = p_company_id AND e.modulo='completo')
      THEN ARRAY['pausas','documentacao','completo']::text[]
    ELSE COALESCE((SELECT array_agg(DISTINCT e.modulo) FROM public.empresa_ehs_modulo e WHERE e.company_id = p_company_id), ARRAY[]::text[])
  END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ehs_modulos_da_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_modulos_da_empresa(uuid) TO authenticated, service_role;

-- 6) RPC do guarda de rota: a empresa pode abrir esta rota EHS? (rota não mapeada a bucket = sim)
CREATE OR REPLACE FUNCTION public.fn_ehs_rota_permitida(p_company_id uuid, p_rota text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tela AS (
    SELECT mc.ehs_modulo
    FROM public.module_catalog mc
    WHERE mc.ehs_modulo IS NOT NULL
      AND mc.rota IS NOT NULL
      AND p_rota LIKE mc.rota || '%'
    ORDER BY length(mc.rota) DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM tela) THEN true          -- rota sem bucket (ex.: /dashboard/ehs) → não bloqueia
    WHEN p_company_id IS NULL THEN true
    WHEN (SELECT ehs_modulo FROM tela) = ANY (public.fn_ehs_modulos_da_empresa(p_company_id)) THEN true
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ehs_rota_permitida(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_rota_permitida(uuid, text) TO authenticated, service_role;
