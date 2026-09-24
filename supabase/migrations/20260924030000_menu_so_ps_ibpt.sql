-- Gate de menu por system_role (PS-only) — o buraco estrutural que o CEO identificou: a RPC do
-- sidebar (fn_modulos_sidebar_por_area) filtra por PLANO + nível + ramo, mas NÃO tinha como esconder
-- uma ferramenta INTERNA da PS. Sem isso, item da PS no menu vazaria para admin de cliente.
--
-- Solução (aditiva, raio mínimo): coluna so_ps em module_catalog (default false → 200+ módulos
-- existentes nascem false, nada muda para ninguém) + UM filtro na RPC: módulo so_ps=true só entra
-- se o usuário for system_role IN ('PS_ADMIN','PS_ADMIN_CVM'). Primeiro uso: o importador da tabela
-- IBPT (Lei 12.741, vence 31/10/2026) em ADMINISTRAÇÃO, para Gilberto/André/Jordana/Rodrigo.
-- A guarda client-side da página CONTINUA (duas camadas). As outras 6 ferramentas da Central seguem
-- fora do menu por ora; este mecanismo destrava colocá-las lá quando o CEO decidir.

alter table public.module_catalog add column if not exists so_ps boolean not null default false;

-- RPC do menu: idêntica à atual, com UM filtro adicional no WHERE final (so_ps). Nada mais muda.
create or replace function public.fn_modulos_sidebar_por_area(p_area_id text, p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
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
    -- GATE PS-ONLY (novo): módulo marcado so_ps só aparece para a equipe PS (system_role). Para
    -- qualquer outro módulo (so_ps=false, o default) é no-op — contagem idêntica para todo mundo.
    AND (
      NOT COALESCE((SELECT mc2.so_ps FROM module_catalog mc2 WHERE mc2.id = t.modulo_id), false)
      OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = p_user_id
                 AND u2.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')))
  ORDER BY COALESCE((SELECT aso.ordem FROM area_secao_ordem aso WHERE aso.area_slug = p_area_id AND aso.secao = t.secao AND aso.ativo = true), t.secao_ordem), t.ordem;
END $function$;

revoke all on function public.fn_modulos_sidebar_por_area(text, uuid, uuid) from anon;
grant execute on function public.fn_modulos_sidebar_por_area(text, uuid, uuid) to authenticated, service_role;

-- Importador da tabela IBPT em ADMINISTRAÇÃO, espelhando "Certificado Digital A1" (mesmo grupo/subgrupo/
-- surface). so_ps=true → só a equipe PS vê. A guarda da página (/dashboard/dev/ibpt) continua.
insert into public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared, surface_in_groups, so_ps)
values (
  'admin_ibpt_tabela', 'Tabela IBPT (Lei 12.741)', 'admin', 'administracao', '🧾', '/dashboard/dev/ibpt', 64, true,
  'Importador da tabela IBPT (alíquotas por NCM×UF, Lei 12.741). Núcleo — uma carga serve todos os tenants. Só equipe PS.',
  null, true, ARRAY['bpo','commerce','gestao_empresarial','hub','industrial','services','custeio_a','custeio_b']::text[], true
)
on conflict (id) do update set
  nome = excluded.nome, grupo = excluded.grupo, subgrupo = excluded.subgrupo, icone = excluded.icone,
  rota = excluded.rota, ordem = excluded.ordem, ativo = excluded.ativo, descricao = excluded.descricao,
  is_shared = excluded.is_shared, surface_in_groups = excluded.surface_in_groups, so_ps = excluded.so_ps;
