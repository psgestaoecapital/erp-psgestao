-- GE Hub (sem_plano / catálogo de módulos): a prontidão dos cards passa a sair
-- da fonte da verdade (system_screens), não de um hardcode PREVISTO/0%.
--
-- GAP (auditor_pdca_2 20/11, RD-38 provado no dado): fn_gestao_empresarial_hub_kpis
-- marcava TODOS os ~62 cards de `cards_modulos` (module_catalog grupo='gestao_empresarial')
-- como status='PREVISTO', pct_pronto=0 e observacao='Em construção.' — INCLUSIVE módulos
-- já prontos e auditados (contas-bancarias nota 96, produtos 96, pagar 95, fiscal/nfe 96,
-- centros-custo 96, financiamento 96, …). Um prospect/trial single-company via sem_plano
-- via o produto inteiro como protótipo 0% "Em construção".
--
-- PROVA RD-38 (BEGIN..ROLLBACK leve, só leitura, na prod):
--   ANTES: 62 cards PREVISTO.
--   DEPOIS: 22 PRONTO, 14 EM CONSTRUÇÃO, 26 PREVISTO (os 26 são as rotas
--           /dashboard/gestao-empresarial/previsto/* que NÃO têm linha em system_screens).
--
-- Regra de derivação (cruza module_catalog.rota × system_screens):
--   sem linha em system_screens            -> PREVISTO  (0%)   — tela ainda não existe / futura
--   auditada_ok = true                     -> PRONTO    (100%) — passou no selo aud8 (>=95)
--   estado_real = 'pronto'                 -> PRONTO    (100%)
--   estado_real = 'parcial'                -> EM CONSTRUÇÃO (50%)
--   estado_real = 'previsto'               -> PREVISTO  (0%)
--   linha existe, estado desconhecido/null -> EM CONSTRUÇÃO (25%) — a tela existe, estado não verificado
--
-- Módulo entregue NUNCA mais carrega observacao 'Em construção.' (corrige a auto-contradição
-- "Em construção. Tabela financiamentos com dados reais disponível.").
--
-- Aditiva/idempotente: CREATE OR REPLACE de função núcleo (SENSÍVEL → revisao-eng-chefe).
-- Mantém assinatura, SET search_path, empty states, bloco de KPIs (fn_modulos_sidebar_por_area),
-- tem_dados por empresa e o shape do retorno. Só muda status/pct_pronto/observacao + ordenação
-- (PRONTO primeiro) dos cards, e separa "prontidão do módulo" (global) de "você já tem dados".

CREATE OR REPLACE FUNCTION public.fn_gestao_empresarial_hub_kpis(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_nome text;
  v_empresa_existe boolean;
  v_modulos jsonb;
  v_kpis jsonb;
  v_empty_state boolean;
  v_total_modulos int;
  v_modulos_construcao int;
  v_modulos_previstos int;
  v_modulos_prontos int;
  v_pct_evolucao_media numeric;
BEGIN
  v_empty_state := (p_company_id IS NULL);

  IF v_empty_state THEN
    RETURN jsonb_build_object(
      'empty_state', true,
      'mensagem', 'Selecione uma empresa para ver dados de Gestão Empresarial',
      'cards_modulos', '[]'::jsonb,
      'kpis', '{}'::jsonb
    );
  END IF;

  -- Validar empresa
  SELECT c.razao_social, EXISTS(
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id=p_company_id
      AND plan_id='v15_gestao_empresarial_pro'
      AND status='active'
  )
  INTO v_empresa_nome, v_empresa_existe
  FROM companies c
  WHERE c.id=p_company_id;

  IF NOT v_empresa_existe THEN
    RETURN jsonb_build_object(
      'empty_state', true,
      'mensagem', 'Empresa não tem plano Gestão Empresarial ativo',
      'cards_modulos', '[]'::jsonb,
      'kpis', '{}'::jsonb,
      'empresa_nome', v_empresa_nome
    );
  END IF;

  -- KPIs FOUNDATIONAL — leem da sidebar REAL via fn_modulos_sidebar_por_area (inalterado)
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status = 'pronto')::int,
    COUNT(*) FILTER (WHERE status = 'parcial')::int,
    COUNT(*) FILTER (WHERE status = 'previsto')::int,
    CASE WHEN COUNT(*) > 0 THEN
      ROUND((
        COUNT(*) FILTER (WHERE status = 'pronto') * 100.0
        + COUNT(*) FILTER (WHERE status = 'parcial') * 50.0
        + COUNT(*) FILTER (WHERE status = 'previsto') * 0.0
      ) / COUNT(*), 0)
    ELSE 0 END
  INTO v_total_modulos, v_modulos_prontos, v_modulos_construcao, v_modulos_previstos, v_pct_evolucao_media
  FROM fn_modulos_sidebar_por_area('gestao_empresarial', p_company_id, NULL);

  -- Cards "Módulos da Área" — prontidão REAL cruzando module_catalog.rota × system_screens.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'titulo', CASE
        WHEN m.id='orcamento_empresarial' THEN 'Orçamento Empresarial'
        WHEN m.id='financiamento' THEN 'Financiamento'
        WHEN m.id='balanco_patrimonial' THEN 'Balanço Patrimonial'
        WHEN m.id='raio_x' THEN 'Raio X Empresarial'
        WHEN m.id='fluxo_caixa_empresarial' THEN 'Fluxo de Caixa'
        ELSE m.nome
      END,
      'descricao', CASE
        WHEN m.id='orcamento_empresarial' THEN 'Planejamento orçamentário anual por linha de negócio com cenários otimista/realista/pessimista.'
        WHEN m.id='financiamento' THEN 'Gestão de financiamentos bancários, parcelas e juros. Captura automática via Open Finance.'
        WHEN m.id='balanco_patrimonial' THEN 'Demonstração contábil estática: ativo, passivo, patrimônio líquido.'
        WHEN m.id='raio_x' THEN 'Diagnóstico 360° da empresa: curvas ABC, indicadores chave, gargalos operacionais.'
        WHEN m.id='fluxo_caixa_empresarial' THEN 'Realizado + projetado. Visão diária, semanal, mensal e anual.'
        ELSE COALESCE(m.descricao, '')
      END,
      'icone', CASE
        WHEN m.id='orcamento_empresarial' THEN '🎯'
        WHEN m.id='financiamento' THEN '🏦'
        WHEN m.id='balanco_patrimonial' THEN '📊'
        WHEN m.id='raio_x' THEN '🔬'
        WHEN m.id='fluxo_caixa_empresarial' THEN '💰'
        ELSE '📦'
      END,
      'cor_tema', 'gold',
      'rota', m.rota,
      'status', m.st,
      'pct_pronto', m.pct,
      -- "você já tem dados" (por empresa) é separado da prontidão do módulo (global)
      'tem_dados', CASE
        WHEN m.id='fluxo_caixa_empresarial' THEN (SELECT COUNT(*) > 0 FROM psgc_fluxo_realizado WHERE company_id=p_company_id)
        WHEN m.id='financiamento' THEN (SELECT COUNT(*) > 0 FROM financiamentos WHERE company_id=p_company_id)
        ELSE false
      END,
      'observacao', CASE
        WHEN m.st = 'PRONTO' THEN 'Pronto para uso.'
        WHEN m.st = 'EM CONSTRUÇÃO' THEN 'Em evolução.'
        ELSE 'Previsto.'
      END
    )
    ORDER BY
      CASE m.st WHEN 'PRONTO' THEN 1 WHEN 'EM CONSTRUÇÃO' THEN 2 ELSE 3 END,
      COALESCE(m.nota, 0) DESC,
      m.nome
  )
  INTO v_modulos
  FROM (
    SELECT
      mc.id, mc.nome, mc.descricao, mc.rota,
      ss.auditada_ok_nota AS nota,
      CASE
        WHEN ss.rota IS NULL THEN 'PREVISTO'
        WHEN ss.auditada_ok IS TRUE THEN 'PRONTO'
        WHEN ss.estado_real = 'pronto' THEN 'PRONTO'
        WHEN ss.estado_real = 'parcial' THEN 'EM CONSTRUÇÃO'
        WHEN ss.estado_real = 'previsto' THEN 'PREVISTO'
        ELSE 'EM CONSTRUÇÃO'  -- linha existe, estado desconhecido/null: a tela existe
      END AS st,
      CASE
        WHEN ss.rota IS NULL THEN 0
        WHEN ss.auditada_ok IS TRUE THEN 100
        WHEN ss.estado_real = 'pronto' THEN 100
        WHEN ss.estado_real = 'parcial' THEN 50
        WHEN ss.estado_real = 'previsto' THEN 0
        ELSE 25
      END AS pct
    FROM module_catalog mc
    LEFT JOIN system_screens ss ON ss.rota = mc.rota
    WHERE mc.grupo='gestao_empresarial'
      AND mc.ativo=true
  ) m;

  v_modulos := COALESCE(v_modulos, '[]'::jsonb);

  SELECT jsonb_build_object(
    'total_modulos', v_total_modulos,
    'modulos_prontos', v_modulos_prontos,
    'modulos_em_construcao', v_modulos_construcao,
    'modulos_previstos', v_modulos_previstos,
    'pct_evolucao_media', v_pct_evolucao_media,
    'registros_fluxo', (SELECT COUNT(*) FROM psgc_fluxo_realizado WHERE company_id=p_company_id),
    'registros_dre', (SELECT COUNT(*) FROM m2_dre_divisional WHERE company_id=p_company_id),
    'registros_financiamentos', (SELECT COUNT(*) FROM financiamentos WHERE company_id=p_company_id),
    'registros_pagar', (SELECT COUNT(*) FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar WHERE company_id=p_company_id),
    'registros_receber', (SELECT COUNT(*) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id=p_company_id)
  ) INTO v_kpis;

  RETURN jsonb_build_object(
    'empty_state', false,
    'empresa_id', p_company_id,
    'empresa_nome', v_empresa_nome,
    'area_titulo', 'Gestão Empresarial Pró',
    'area_descricao', 'Plataforma integrada de gestão financeira, orçamentária e patrimonial.',
    'kpis', v_kpis,
    'cards_modulos', v_modulos,
    'plano_nome', 'Gestão Empresarial Pró',
    'plano_valor_mensal', 149.00,
    'status_comercial', 'piloto'
  );
END;
$function$;
