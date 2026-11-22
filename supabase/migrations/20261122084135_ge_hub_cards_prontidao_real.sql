-- PDCA GE · /dashboard/gestao-empresarial (auditor_pdca_2 20/11) · GAP1 (princípio 3 + RD-98):
-- fn_gestao_empresarial_hub_kpis pintava TODOS os ~62 cards de `cards_modulos` com
-- status='PREVISTO', pct_pronto=0 e observacao='Em construção.' — hard-coded —, INCLUSIVE
-- módulos entregues e auditados (contas-bancarias 96, produtos 96, pagar 95, centros-custo 96,
-- financiamento 96, nfe 96...). O ModuleCard então mostrava o produto maduro como protótipo 0%.
-- A RPC NÃO cruzava `module_catalog.rota` com `system_screens` (fonte de prontidão).
--
-- Correção (só a derivação dos cards muda; resto do corpo idêntico ao VIVO lido por
-- pg_get_functiondef). Cada card deriva status/pct/observacao de system_screens por rota:
--   auditada_ok=true OU estado_real='pronto' → 'PRONTO' (100%, sem "Em construção")
--   estado_real='parcial'                    → 'EM CONSTRUÇÃO' (50%)
--   senão (sem tela/estado null/previsto)     → 'PREVISTO' (0%)
-- 'PRONTO'/'EM CONSTRUÇÃO'/'PREVISTO' são os literais que ModuleCard.statusStyle estiliza
-- (PRONTO em destaque espresso). `tem_dados` (ponto dourado, por empresa) segue separado da
-- prontidão (global). Cards ordenados prontos-primeiro (percepção do prospect).
--
-- Prova RD-38 (produção, SELECT read-only, BEGIN sem escrita): ANTES 62 PREVISTO →
-- DEPOIS 22 PRONTO / 13 EM CONSTRUÇÃO / 27 PREVISTO; amostra contas-bancarias, produtos,
-- pagar, nfe, centros-custo, financiamento: PREVISTO → PRONTO. system_screens.rota é única
-- (345/345), LEFT JOIN não duplica card.
--
-- SECURITY INVOKER, aditiva (só CREATE OR REPLACE da derivação), não toca dado de cliente.
-- ACL mantida (authenticated, service_role; sem anon).

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

  -- 🆕 KPIs FOUNDATIONAL — leem da sidebar REAL via fn_modulos_sidebar_por_area
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

  -- Cards "Módulos da Área" — status/pct/observacao agora derivam da prontidão REAL
  -- (system_screens por rota), não mais do PREVISTO/0% fixo.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', mc.id,
      'titulo', CASE
        WHEN mc.id='orcamento_empresarial' THEN 'Orçamento Empresarial'
        WHEN mc.id='financiamento' THEN 'Financiamento'
        WHEN mc.id='balanco_patrimonial' THEN 'Balanço Patrimonial'
        WHEN mc.id='raio_x' THEN 'Raio X Empresarial'
        WHEN mc.id='fluxo_caixa_empresarial' THEN 'Fluxo de Caixa'
        ELSE mc.nome
      END,
      'descricao', CASE
        WHEN mc.id='orcamento_empresarial' THEN 'Planejamento orçamentário anual por linha de negócio com cenários otimista/realista/pessimista.'
        WHEN mc.id='financiamento' THEN 'Gestão de financiamentos bancários, parcelas e juros. Captura automática via Open Finance.'
        WHEN mc.id='balanco_patrimonial' THEN 'Demonstração contábil estática: ativo, passivo, patrimônio líquido.'
        WHEN mc.id='raio_x' THEN 'Diagnóstico 360° da empresa: curvas ABC, indicadores chave, gargalos operacionais.'
        WHEN mc.id='fluxo_caixa_empresarial' THEN 'Realizado + projetado. Visão diária, semanal, mensal e anual.'
        ELSE COALESCE(mc.descricao, '')
      END,
      'icone', CASE
        WHEN mc.id='orcamento_empresarial' THEN '🎯'
        WHEN mc.id='financiamento' THEN '🏦'
        WHEN mc.id='balanco_patrimonial' THEN '📊'
        WHEN mc.id='raio_x' THEN '🔬'
        WHEN mc.id='fluxo_caixa_empresarial' THEN '💰'
        ELSE '📦'
      END,
      'cor_tema', 'gold',
      'rota', mc.rota,
      'status', CASE
        WHEN s.auditada_ok IS TRUE OR s.estado_real = 'pronto' THEN 'PRONTO'
        WHEN s.estado_real = 'parcial' THEN 'EM CONSTRUÇÃO'
        ELSE 'PREVISTO'
      END,
      'pct_pronto', CASE
        WHEN s.auditada_ok IS TRUE OR s.estado_real = 'pronto' THEN 100
        WHEN s.estado_real = 'parcial' THEN 50
        ELSE 0
      END,
      'tem_dados', CASE
        WHEN mc.id='fluxo_caixa_empresarial' THEN (SELECT COUNT(*) > 0 FROM psgc_fluxo_realizado WHERE company_id=p_company_id)
        WHEN mc.id='financiamento' THEN (SELECT COUNT(*) > 0 FROM financiamentos WHERE company_id=p_company_id)
        ELSE false
      END,
      'observacao', CASE
        WHEN s.auditada_ok IS TRUE OR s.estado_real = 'pronto' THEN NULL
        WHEN s.estado_real = 'parcial' THEN 'Em evolução — já utilizável, recebendo melhorias.'
        ELSE 'Planejado no roteiro do produto.'
      END
    )
    ORDER BY
      CASE
        WHEN s.auditada_ok IS TRUE OR s.estado_real = 'pronto' THEN 0
        WHEN s.estado_real = 'parcial' THEN 1
        ELSE 2
      END,
      COALESCE(mc.nome, mc.id)
  )
  INTO v_modulos
  FROM module_catalog mc
  LEFT JOIN system_screens s ON s.rota = mc.rota
  WHERE mc.grupo='gestao_empresarial'
    AND mc.ativo=true;

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

-- ACL idêntica à viva (função SECURITY INVOKER; sem anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_gestao_empresarial_hub_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gestao_empresarial_hub_kpis(uuid) TO authenticated, service_role;
