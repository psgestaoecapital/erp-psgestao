-- ═══════════════════════════════════════════════════════════════
-- PR M.A.8.0: Views + RPCs adicionais para destravar UI Admin
-- ═══════════════════════════════════════════════════════════════
-- Autor: Claude (Engenheiro Chefe Senior)
-- Data: 10/05/2026 sessao 6 | Marco M.A.8 UI Admin
--
-- OBJETIVO: Pre-fabricar tudo que UI vai consumir (RPCs + views)
-- para Code Web focar APENAS em frontend, sem perder tempo em SQL.
--
-- ENTREGAS:
-- 1. v_admin_planos_completo (1 row por plano com modulos+features count)
-- 2. v_admin_plano_modulos (relacao plano -> modulos com detalhes)
-- 3. v_admin_modulo_features (relacao modulo -> features)
-- 4. v_admin_truth_dashboard (resumo executivo Truth Auditor)
-- 5. v_admin_roadmap_completo (roadmap + caminho critico)
-- 6. fn_admin_executar_truth_auditor (wrapper para UI button)
-- 7. fn_admin_get_plano_detalhe (RPC tudo em um plano)
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- VIEW 1: v_admin_planos_completo (lista principal /admin/planos)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_admin_planos_completo CASCADE;
CREATE VIEW public.v_admin_planos_completo AS
SELECT
  p.id AS plan_id,
  p.nome AS plano_nome,
  p.tier_internal,
  p.vertical,
  p.plan_group,
  p.preco_min,
  p.preco_max,
  p.max_usuarios,
  p.max_empresas,
  p.descricao,
  p.ativo,
  p.legacy,
  p.sla_level,
  p.billing_model,
  -- Contagens dinamicas
  (SELECT COUNT(DISTINCT pm.module_id) FROM plan_modules pm WHERE pm.plan_id = p.id) AS total_modulos,
  (SELECT COUNT(DISTINCT f.id) FROM plan_modules pm
    JOIN feature_catalog f ON f.module_id = pm.module_id
    WHERE pm.plan_id = p.id) AS total_features,
  (SELECT COUNT(DISTINCT f.id) FROM plan_modules pm
    JOIN feature_catalog f ON f.module_id = pm.module_id
    WHERE pm.plan_id = p.id AND f.status = 'pronto') AS features_prontas,
  -- % pronto para vender
  CASE
    WHEN (SELECT COUNT(f.id) FROM plan_modules pm
          JOIN feature_catalog f ON f.module_id = pm.module_id
          WHERE pm.plan_id = p.id) = 0 THEN 0
    ELSE ROUND(
      (SELECT COUNT(f.id) FROM plan_modules pm
        JOIN feature_catalog f ON f.module_id = pm.module_id
        WHERE pm.plan_id = p.id AND f.status = 'pronto')::numeric * 100.0 /
      (SELECT COUNT(f.id) FROM plan_modules pm
        JOIN feature_catalog f ON f.module_id = pm.module_id
        WHERE pm.plan_id = p.id)::numeric
    , 0)
  END AS percentual_pronto_para_vender,
  -- Subscriptions ativas
  (SELECT COUNT(DISTINCT ts.company_id) FROM tenant_subscriptions ts
    WHERE ts.plan_id = p.id AND ts.status = 'active') AS clientes_ativos,
  (SELECT COALESCE(SUM(ts.monthly_price_brl), 0)::numeric(12,2) FROM tenant_subscriptions ts
    WHERE ts.plan_id = p.id AND ts.status = 'active') AS mrr_real
FROM plan_catalog p
ORDER BY p.ativo DESC, p.vertical NULLS LAST, p.tier_internal NULLS LAST, p.id;

COMMENT ON VIEW public.v_admin_planos_completo IS
'Lista executiva de planos para /admin/planos. Inclui contagens, % pronto, MRR real. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- VIEW 2: v_admin_plano_modulos (drill-down plano -> modulos)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_admin_plano_modulos CASCADE;
CREATE VIEW public.v_admin_plano_modulos AS
SELECT
  pm.plan_id,
  m.id AS module_id,
  m.nome AS modulo_nome,
  m.layer,
  m.grupo,
  m.descricao AS modulo_descricao,
  pm.is_default_active,
  pm.minimum_sla,
  pm.legacy AS vinculo_legacy,
  -- Contagem features deste modulo
  (SELECT COUNT(*) FROM feature_catalog f WHERE f.module_id = m.id) AS total_features,
  (SELECT COUNT(*) FROM feature_catalog f WHERE f.module_id = m.id AND f.status = 'pronto') AS features_prontas,
  (SELECT COUNT(*) FROM feature_catalog f WHERE f.module_id = m.id AND f.status = 'parcial') AS features_parciais,
  (SELECT COUNT(*) FROM feature_catalog f WHERE f.module_id = m.id AND f.status = 'previsto') AS features_previstas
FROM plan_modules pm
JOIN module_catalog m ON m.id = pm.module_id
WHERE m.ativo = true
ORDER BY pm.plan_id, m.layer, m.nome;

COMMENT ON VIEW public.v_admin_plano_modulos IS
'Drill-down: dado um plan_id, lista modulos vinculados com status. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- VIEW 3: v_admin_modulo_features (drill-down modulo -> features)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_admin_modulo_features CASCADE;
CREATE VIEW public.v_admin_modulo_features AS
SELECT
  f.id AS feature_id,
  f.module_id,
  m.nome AS modulo_nome,
  f.area,
  f.titulo,
  f.descricao_executiva,
  f.descricao_tecnica,
  f.status,
  f.percentual_pronto,
  f.prioridade,
  f.cobre_planos,
  f.prs_relacionados,
  f.marcos_roadmap,
  f.observacao,
  f.atualizado_em
FROM feature_catalog f
JOIN module_catalog m ON m.id = f.module_id
ORDER BY f.module_id, f.prioridade, f.titulo;

COMMENT ON VIEW public.v_admin_modulo_features IS
'Drill-down: dado um module_id, lista features detalhadas. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- VIEW 4: v_admin_truth_dashboard (Truth Auditor resumo)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_admin_truth_dashboard CASCADE;
CREATE VIEW public.v_admin_truth_dashboard AS
SELECT
  'regras_ativas' AS metrica,
  COUNT(*)::text AS valor,
  'info' AS tipo,
  NULL::timestamptz AS timestamp
FROM truth_audit_rules WHERE ativo = true
UNION ALL
SELECT 'alertas_abertos', COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN 'warn' ELSE 'success' END,
  NULL
FROM erp_truth_alerts WHERE status = 'novo'
UNION ALL
SELECT 'alertas_criticos', COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN 'critical' ELSE 'success' END,
  NULL
FROM erp_truth_alerts WHERE status = 'novo' AND severity = 'critical'
UNION ALL
SELECT 'ultima_execucao',
  COALESCE(MAX(detected_at)::text, 'nunca'),
  'info',
  MAX(detected_at)
FROM erp_truth_alerts
UNION ALL
SELECT 'empresas_auditadas', COUNT(DISTINCT company_id)::text, 'info', NULL
FROM erp_truth_alerts WHERE status = 'novo';

COMMENT ON VIEW public.v_admin_truth_dashboard IS
'Resumo executivo Truth Auditor para card no /admin/truth. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- VIEW 5: v_admin_roadmap_completo (Roadmap visual)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_admin_roadmap_completo CASCADE;
CREATE VIEW public.v_admin_roadmap_completo AS
SELECT
  m.id AS marco_id,
  m.trilha,
  m.trilha_nome,
  m.titulo,
  m.descricao,
  m.criterio_pronto,
  m.status,
  m.percentual_concluido,
  m.prioridade,
  m.caminho_critico,
  m.iniciado_em,
  m.concluido_em,
  m.estimativa_conclusao,
  m.bloqueador,
  m.observacao,
  m.prs_relacionados,
  m.ondas_relacionadas,
  -- Cor para UI baseada em status + caminho critico
  CASE
    WHEN m.status = 'concluido' THEN 'green'
    WHEN m.status = 'em_andamento' AND m.caminho_critico THEN 'amber'
    WHEN m.status = 'em_andamento' THEN 'blue'
    WHEN m.status = 'pausado' THEN 'gray'
    WHEN m.caminho_critico THEN 'red'
    ELSE 'slate'
  END AS cor_ui,
  -- Icone
  CASE
    WHEN m.status = 'concluido' THEN '✅'
    WHEN m.status = 'em_andamento' THEN '🔄'
    WHEN m.status = 'pausado' THEN '⏸️'
    ELSE '⏳'
  END AS icone
FROM erp_roadmap_marcos m
ORDER BY
  CASE m.trilha WHEN 'A_core' THEN 1 WHEN 'B_comercial' THEN 2
                WHEN 'C_suporte' THEN 3 WHEN 'D_operacao' THEN 4 END,
  m.ordem_na_trilha;

COMMENT ON VIEW public.v_admin_roadmap_completo IS
'Roadmap completo com cores e icones para UI /admin/roadmap. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- RPC: fn_admin_executar_truth_auditor (wrapper para UI button)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_executar_truth_auditor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_resultado jsonb;
  v_total_alertas integer;
  v_total_criticas integer;
  v_inicio timestamptz;
BEGIN
  v_inicio := NOW();

  -- Executar as 3 RPCs do orquestrador
  PERFORM fn_truth_audit_executar_todas();

  -- Coletar resultado
  SELECT
    COUNT(*) FILTER (WHERE status = 'novo'),
    COUNT(*) FILTER (WHERE status = 'novo' AND severity = 'critical')
  INTO v_total_alertas, v_total_criticas
  FROM erp_truth_alerts;

  v_resultado := jsonb_build_object(
    'success', true,
    'executed_at', v_inicio,
    'duration_ms', EXTRACT(MILLISECONDS FROM (NOW() - v_inicio))::int,
    'total_alertas_abertos', v_total_alertas,
    'alertas_criticos', v_total_criticas,
    'mensagem',
      CASE
        WHEN v_total_criticas > 0 THEN
          'CRITICO: ' || v_total_criticas || ' divergencias criticas detectadas'
        WHEN v_total_alertas > 0 THEN
          v_total_alertas || ' alertas detectados (sem criticos)'
        ELSE
          'DRE 100% INTEGRO - 0 divergencias'
      END
  );

  RETURN v_resultado;
END $func$;

COMMENT ON FUNCTION public.fn_admin_executar_truth_auditor IS
'Wrapper UI: executa Truth Auditor e retorna JSON resumido para frontend. PR M.A.8.0.';

-- ───────────────────────────────────────────────────────────────
-- RPC: fn_admin_get_plano_detalhe (tudo de um plano em 1 call)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_get_plano_detalhe(p_plan_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_plano jsonb;
  v_modulos jsonb;
  v_features jsonb;
BEGIN
  -- Plano basico
  SELECT to_jsonb(v.*) INTO v_plano
  FROM v_admin_planos_completo v WHERE v.plan_id = p_plan_id;

  IF v_plano IS NULL THEN
    RETURN jsonb_build_object('error', 'Plano nao encontrado: ' || p_plan_id);
  END IF;

  -- Modulos do plano
  SELECT jsonb_agg(to_jsonb(v.*)) INTO v_modulos
  FROM v_admin_plano_modulos v WHERE v.plan_id = p_plan_id;

  -- Features de todos modulos do plano
  SELECT jsonb_agg(to_jsonb(f.*)) INTO v_features
  FROM v_admin_modulo_features f
  WHERE f.module_id IN (
    SELECT module_id FROM plan_modules WHERE plan_id = p_plan_id
  );

  RETURN jsonb_build_object(
    'plano', v_plano,
    'modulos', COALESCE(v_modulos, '[]'::jsonb),
    'features', COALESCE(v_features, '[]'::jsonb),
    'gerado_em', NOW()
  );
END $func$;

COMMENT ON FUNCTION public.fn_admin_get_plano_detalhe IS
'Retorna plano + modulos + features em 1 call. Usado em /admin/planos/[id]. PR M.A.8.0.';
