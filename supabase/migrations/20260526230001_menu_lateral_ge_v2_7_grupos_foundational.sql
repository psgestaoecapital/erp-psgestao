-- PR-FIX-MENU-FOUNDATIONAL-V2 (CEO 26/05/2026 · menu_foundational_v2)
-- Aplicado via MCP apply_migration · rastreio histórico.
--
-- BUG: Menu lateral GE com 16 seções confusas (FINANCEIRO RECORRENTE,
-- FINANCEIRO UNIFICADO, VISAO EXECUTIVA, VISAO DIARIA SEPARADA, etc.)
-- mais rotas duplicadas (financeiro, contas_pagar_receber) e previstas
-- (financiamento, balanco_patrimonial, raio_x) bagunçavam a UX.
--
-- Resolve foundationalmente reorganizando em 7 grupos PT-BR claros:
-- INÍCIO · FINANCEIRO · CONTRATOS & VENDAS · ANÁLISES & RELATÓRIOS ·
-- INTELIGÊNCIA & PROTEÇÃO · CADASTROS · ADMINISTRAÇÃO (admin-only).
--
-- Marca 9 diferenciais PS via coluna nova `diferencial` em module_catalog ·
-- frontend renderiza ★ dourado pequeno ao lado do nome.
--
-- ANTI-REGRESSÃO: Mantém TODOS os labels CASE backward-compatible
-- (docs_regulatorios, controle_epis, compliance_legal etc) pra não quebrar
-- as outras áreas (BPO, Industrial, Compliance, Wealth, Assessor, etc).

ALTER TABLE module_catalog ADD COLUMN IF NOT EXISTS diferencial boolean DEFAULT false;

-- 7 grupos foundational (apenas itens GE)
UPDATE module_catalog SET subgrupo='inicio', ordem=10, diferencial=true WHERE id='consultor_ia';

UPDATE module_catalog SET subgrupo='financeiro', ordem=10 WHERE id='financeiro_listagem_pagar';
UPDATE module_catalog SET subgrupo='financeiro', ordem=20 WHERE id='financeiro_listagem_receber';
UPDATE module_catalog SET subgrupo='financeiro', ordem=30, diferencial=true WHERE id='financeiro_inadimplentes_ge';
UPDATE module_catalog SET subgrupo='financeiro', ordem=40 WHERE id='financeiro_extrato_ge';
UPDATE module_catalog SET subgrupo='financeiro', ordem=50, diferencial=true WHERE id='conciliacao_geral';
UPDATE module_catalog SET subgrupo='financeiro', ordem=60 WHERE id='previsao_caixa';
UPDATE module_catalog SET subgrupo='financeiro', ordem=70, diferencial=true WHERE id='financeiro_saude_ge';
UPDATE module_catalog SET subgrupo='financeiro', ordem=80 WHERE id='financeiro_nova_despesa';
UPDATE module_catalog SET subgrupo='financeiro', ordem=90 WHERE id='financeiro_nova_receita';

UPDATE module_catalog SET subgrupo='contratos_vendas', ordem=10, diferencial=true WHERE id='ge_cadastros_contratos_recorrentes';
UPDATE module_catalog SET subgrupo='contratos_vendas', ordem=20, diferencial=true WHERE id='services_contratos_recorrentes';
UPDATE module_catalog SET subgrupo='contratos_vendas', ordem=30 WHERE id='orcamento';

UPDATE module_catalog SET subgrupo='analises', ordem=10, diferencial=true WHERE id='dre_divisional_modulo';
UPDATE module_catalog SET subgrupo='analises', ordem=20 WHERE id='analises_financeiras';
UPDATE module_catalog SET subgrupo='analises', ordem=30 WHERE id='operacional';
UPDATE module_catalog SET subgrupo='analises', ordem=40 WHERE id='resultado_dre';

UPDATE module_catalog SET subgrupo='inteligencia_protecao', ordem=10, diferencial=true WHERE id='score_inadimplencia';

UPDATE module_catalog SET subgrupo='cadastros', ordem=10 WHERE id='ge_cadastros_clientes';
UPDATE module_catalog SET subgrupo='cadastros', ordem=20 WHERE id='ge_cadastros_fornecedores';
UPDATE module_catalog SET subgrupo='cadastros', ordem=30 WHERE id='ge_cadastros_contas_bancarias';
UPDATE module_catalog SET subgrupo='cadastros', ordem=40 WHERE id='ge_cadastros_plano_contas';
UPDATE module_catalog SET subgrupo='cadastros', ordem=50 WHERE id='ge_cadastros_linhas_negocio';
UPDATE module_catalog SET subgrupo='cadastros', ordem=60 WHERE id='importer_universal';

-- Esconder rotas duplicadas/quebradas/previstas
UPDATE module_catalog SET ativo=false WHERE id IN (
  'financeiro', 'contas_pagar_receber', 'custos_detalhados',
  'financiamento', 'balanco_patrimonial', 'raio_x',
  'rateio', 'viabilidade'
);

-- PS Assessor: tirar do menu GE (mas mantém ativo pra área Assessor)
UPDATE module_catalog
SET surface_in_groups = array_remove(surface_in_groups, 'gestao_empresarial')
WHERE id='assessor';

-- DROP + CREATE fn_modulos_sidebar_por_area com nova coluna `diferencial`
DROP FUNCTION IF EXISTS public.fn_modulos_sidebar_por_area(text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_modulos_sidebar_por_area(
  p_area_id text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  secao text, secao_label text, modulo_id text, nome text, rota text,
  icone text, ordem integer, status text, badge_label text, badge_color text,
  diferencial boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_role text;
  v_user_nivel text;
  v_aplicar_filtro_empresa boolean := (p_company_id IS NOT NULL);
  v_aplicar_filtro_nivel boolean := (p_user_id IS NOT NULL);
BEGIN
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
      AND (NOT v_aplicar_filtro_empresa OR mc.id IN (SELECT module_id FROM modulos_pagos_empresa))
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
  ORDER BY t.secao_ordem, t.ordem;
END $function$;

INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES (
  'F.layout.menu_lateral_GE_v2',
  'consultor_ia',
  'gestao_empresarial',
  'Menu Lateral GE V2 · 7 grupos foundational · intuitivo + completo',
  '16 secoes confusas reorganizadas em 7 grupos PT-BR claros. Coluna diferencial adicionada · 9 itens marcados como diferenciais PS. Rotas duplicadas/previstas escondidas. PR menu_foundational_v2.',
  'pronto', 100, 'critica'
)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100, atualizado_em=NOW();
