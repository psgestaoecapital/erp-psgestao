-- RD-38 (núcleo financeiro · jornada 5 GE: fechamento/contador/balanço)
-- Classe "soma de título SOFT-DELETADO" — mesma já consertada em fn_ge_extrato_conta (#5760),
-- fn_fluxo_caixa_diario (#5836) e nas read-models renegociado do #6045.
-- O #6045 excluiu 'renegociado' nestas 3 funções, mas elas continuavam somando os títulos
-- soft-deletados (deleted_at NOT NULL) de erp_receber/erp_pagar.
--
-- PROVA RD-38 (DEMO GE b0700000-0000-4000-a000-000000000004, 26/11, função VIVA):
--   fn_psgc_balanco_gerencial: contas_a_receber R$ 10.000.036.082.064,24 (10 TRI) -> R$ 23.641,28 (deleted_at IS NULL)
--   fornecedores R$ 213.395.169,13 -> ~R$ 332.407,15 (varia com a DEMO viva, 190k linhas soft-del fora)
--
-- Correções desta migration (ADITIVAS, só read-models, NÃO tocam dado de cliente):
--   1) fn_psgc_balanco_gerencial       -> AND deleted_at IS NULL nos SELECT de erp_receber e erp_pagar
--   2) fn_contador_resumo_competencia  -> AND deleted_at IS NULL nos 4 SELECT (competência + caixa)
--   3) fn_ge_painel_contador           -> AND deleted_at IS NULL na inadimplência + conserto de schema-drift
--      (contador_clientes.empresa_id -> company_id; alertas_contador.empresa_id/resolvido/criticidade
--       -> company_id/lido/urgencia; contador_acessos_log sem coluna "detalhes"). Sem isso o painel
--      nem roda (ERRO 42703).

-- ============================================================================
-- 1) BALANÇO GERENCIAL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_psgc_balanco_gerencial(p_company_ids uuid[], p_data_corte date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_data date := COALESCE(p_data_corte, CURRENT_DATE);
  v_caixa numeric := 0; v_contas_receber numeric := 0; v_estoque numeric := 0;
  v_outros_ac numeric := 0; v_ativo_circulante numeric := 0;
  v_realizavel_lp numeric := 0; v_imobilizado numeric := 0; v_intangivel numeric := 0;
  v_ativo_nao_circulante numeric := 0; v_ativo_total numeric := 0;
  v_fornecedores numeric := 0; v_emprestimos_cp numeric := 0;
  v_obrigacoes_fiscais numeric := 0; v_obrigacoes_trabalhistas numeric := 0;
  v_outros_pc numeric := 0; v_passivo_circulante numeric := 0;
  v_emprestimos_lp numeric := 0; v_passivo_nao_circulante numeric := 0;
  v_capital_social numeric := 0; v_lucros_acumulados numeric := 0;
  v_patrimonio_liquido numeric := 0;
BEGIN
  -- Caixa: último saldo do fluxo realizado por empresa
  SELECT COALESCE(SUM(saldo_dia), 0) INTO v_caixa
  FROM (
    SELECT DISTINCT ON (company_id) saldo_dia
    FROM psgc_fluxo_realizado
    WHERE company_id = ANY(p_company_ids) AND data <= v_data
    ORDER BY company_id, data DESC
  ) t;

  -- AR
  SELECT COALESCE(SUM(valor), 0) INTO v_contas_receber
  FROM erp_receber
  WHERE company_id = ANY(p_company_ids)
    AND status NOT IN ('recebido','pago','cancelado','CANCELADO','renegociado')
    AND deleted_at IS NULL;

  -- Imobilizado e Intangível: se balanco_patrimonial tiver dados manuais
  SELECT
    COALESCE(SUM(valor) FILTER (WHERE grupo ILIKE '%imobiliz%'), 0),
    COALESCE(SUM(valor) FILTER (WHERE grupo ILIKE '%intangiv%' OR grupo ILIKE '%intangível%'), 0)
  INTO v_imobilizado, v_intangivel
  FROM balanco_patrimonial
  WHERE company_id = ANY(p_company_ids)
    AND lado = 'ativo';

  v_ativo_circulante := v_caixa + v_contas_receber + v_estoque + v_outros_ac;
  v_ativo_nao_circulante := v_realizavel_lp + v_imobilizado + v_intangivel;
  v_ativo_total := v_ativo_circulante + v_ativo_nao_circulante;

  -- AP separando obrigações fiscais
  SELECT
    COALESCE(SUM(valor) FILTER (
      WHERE NOT (fornecedor_nome ILIKE '%inss%' OR fornecedor_nome ILIKE '%simples%'
                 OR fornecedor_nome ILIKE '%fgts%' OR fornecedor_nome ILIKE '%das%'
                 OR fornecedor_nome ILIKE '%irrf%' OR fornecedor_nome ILIKE '%pis%'
                 OR fornecedor_nome ILIKE '%cofins%' OR fornecedor_nome ILIKE '%csll%')
    ), 0),
    COALESCE(SUM(valor) FILTER (
      WHERE fornecedor_nome ILIKE '%inss%' OR fornecedor_nome ILIKE '%simples%'
         OR fornecedor_nome ILIKE '%fgts%' OR fornecedor_nome ILIKE '%das%'
         OR fornecedor_nome ILIKE '%irrf%' OR fornecedor_nome ILIKE '%pis%'
         OR fornecedor_nome ILIKE '%cofins%' OR fornecedor_nome ILIKE '%csll%'
    ), 0)
  INTO v_fornecedores, v_obrigacoes_fiscais
  FROM erp_pagar
  WHERE company_id = ANY(p_company_ids)
    AND status NOT IN ('pago','cancelado','CANCELADO')
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(capital_social), 0) INTO v_capital_social
  FROM companies WHERE id = ANY(p_company_ids);

  v_passivo_circulante := v_fornecedores + v_emprestimos_cp + v_obrigacoes_fiscais + v_obrigacoes_trabalhistas + v_outros_pc;
  v_passivo_nao_circulante := v_emprestimos_lp;
  v_patrimonio_liquido := v_ativo_total - v_passivo_circulante - v_passivo_nao_circulante;
  v_lucros_acumulados := v_patrimonio_liquido - v_capital_social;

  RETURN jsonb_build_object(
    'data_corte', v_data,
    'ativo', jsonb_build_object(
      'circulante', jsonb_build_object(
        'caixa_equivalentes', v_caixa,
        'contas_a_receber', v_contas_receber,
        'estoques', v_estoque,
        'outros', v_outros_ac,
        'total', v_ativo_circulante
      ),
      'nao_circulante', jsonb_build_object(
        'realizavel_longo_prazo', v_realizavel_lp,
        'imobilizado', v_imobilizado,
        'intangivel', v_intangivel,
        'total', v_ativo_nao_circulante
      ),
      'total', v_ativo_total
    ),
    'passivo', jsonb_build_object(
      'circulante', jsonb_build_object(
        'fornecedores', v_fornecedores,
        'emprestimos_cp', v_emprestimos_cp,
        'obrigacoes_fiscais', v_obrigacoes_fiscais,
        'obrigacoes_trabalhistas', v_obrigacoes_trabalhistas,
        'outros', v_outros_pc,
        'total', v_passivo_circulante
      ),
      'nao_circulante', jsonb_build_object(
        'emprestimos_lp', v_emprestimos_lp,
        'total', v_passivo_nao_circulante
      ),
      'total', v_passivo_circulante + v_passivo_nao_circulante
    ),
    'patrimonio_liquido', jsonb_build_object(
      'capital_social', v_capital_social,
      'lucros_acumulados', v_lucros_acumulados,
      'total', v_patrimonio_liquido
    ),
    'tipo', 'gerencial_derivado'
  );
END $function$;

-- ============================================================================
-- 2) RESUMO DE COMPETÊNCIA DO CONTADOR
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_contador_resumo_competencia(p_company_id uuid, p_mes_competencia date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receitas_competencia numeric;
  v_despesas_competencia numeric;
  v_receitas_caixa numeric;
  v_despesas_caixa numeric;
  v_periodo_fim date;
BEGIN
  -- Isolamento multi-tenant (classe fn__guarda_empresa): SECURITY DEFINER lê financeiro
  -- a partir do p_company_id vindo do parâmetro, fora do RLS. Fail-open p/ service_role/admin,
  -- bloqueia usuário autenticado que peça empresa fora do seu vínculo.
  PERFORM public.fn__guarda_empresa(p_company_id);

  v_periodo_fim := (p_mes_competencia + INTERVAL '1 month' - INTERVAL '1 day')::date;

  -- Regime competencia
  SELECT COALESCE(SUM(valor), 0) INTO v_receitas_competencia
  FROM erp_receber
  WHERE company_id = p_company_id
    AND data_competencia BETWEEN p_mes_competencia AND v_periodo_fim
    AND status != 'cancelado' AND (status IS NULL OR status <> 'renegociado')
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(valor), 0) INTO v_despesas_competencia
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND data_competencia BETWEEN p_mes_competencia AND v_periodo_fim
    AND status != 'cancelado'
    AND deleted_at IS NULL;

  -- Regime caixa
  SELECT COALESCE(SUM(valor_pago), 0) INTO v_receitas_caixa
  FROM erp_receber
  WHERE company_id = p_company_id
    AND data_pagamento BETWEEN p_mes_competencia AND v_periodo_fim
    AND status IN ('pago', 'recebido')
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(valor_pago), 0) INTO v_despesas_caixa
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND data_pagamento BETWEEN p_mes_competencia AND v_periodo_fim
    AND status = 'pago'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'mes_competencia', p_mes_competencia,
    'periodo', jsonb_build_object('inicio', p_mes_competencia, 'fim', v_periodo_fim),
    'competencia', jsonb_build_object(
      'receitas', v_receitas_competencia,
      'despesas', v_despesas_competencia,
      'resultado', v_receitas_competencia - v_despesas_competencia
    ),
    'caixa', jsonb_build_object(
      'receitas', v_receitas_caixa,
      'despesas', v_despesas_caixa,
      'resultado', v_receitas_caixa - v_despesas_caixa
    ),
    'diferenca_competencia_caixa', (v_receitas_competencia - v_despesas_competencia) - (v_receitas_caixa - v_despesas_caixa)
  );
END;
$function$;

-- ============================================================================
-- 3) PAINEL DO CONTADOR
--    Conserta o schema-drift que impedia a função de rodar (ERRO 42703) e
--    adiciona o filtro de soft-delete na inadimplência.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_ge_painel_contador(p_contador_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresas jsonb;
  v_total_empresas int;
  v_total_receita_mes numeric := 0;
  v_total_inadimplencia numeric := 0;
  v_total_obrigacoes_vencer int := 0;
  v_alertas_criticos jsonb;
BEGIN
  -- Isolamento multi-tenant + guarda de escrita (contador_acessos_log): o painel é do próprio
  -- contador. Fail-open p/ service_role/admin (auth.uid() NULL), bloqueia usuário autenticado
  -- que não seja o contador dono do painel.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND auth.uid() IS DISTINCT FROM p_contador_id THEN
    RAISE EXCEPTION 'acesso negado ao painel do contador' USING ERRCODE = '42501';
  END IF;

  -- Buscar todas as empresas do contador
  WITH empresas_contador AS (
    SELECT cc.company_id, c.razao_social, c.cnpj
    FROM contador_clientes cc
    JOIN companies c ON c.id = cc.company_id
    WHERE cc.contador_id = p_contador_id
      AND COALESCE(cc.ativo, true) = true
  ),
  metricas AS (
    SELECT
      ec.company_id,
      ec.razao_social,
      ec.cnpj,
      -- Receita do mês (psgc_dre receita_bruta)
      COALESCE((
        SELECT SUM(valor)
        FROM psgc_dre
        WHERE company_id = ec.company_id
          AND psgc_codigo LIKE '1.%'
          AND ano = EXTRACT(YEAR FROM CURRENT_DATE)
          AND mes = EXTRACT(MONTH FROM CURRENT_DATE)
          AND regime = 'competencia'
      ), 0) AS receita_mes,
      -- Inadimplência (erp_receber vencido, ignora soft-deletado)
      COALESCE((
        SELECT SUM(valor)
        FROM erp_receber
        WHERE company_id = ec.company_id
          AND status NOT IN ('recebido','pago','renegociado')
          AND COALESCE(status,'') != 'orcamento'
          AND data_vencimento < CURRENT_DATE
          AND deleted_at IS NULL
      ), 0) AS inadimplencia,
      -- Obrigações próximas (próximos 7 dias)
      COALESCE((
        SELECT COUNT(*)
        FROM fiscal_calendario
        WHERE company_id = ec.company_id
          AND status != 'pago'
          AND vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      ), 0) AS obrigacoes_proximas,
      -- Alertas ativos (consolidação)
      (
        SELECT COUNT(*)
        FROM alertas_contador
        WHERE company_id = ec.company_id
          AND COALESCE(lido, false) = false
      ) AS alertas_ativos
    FROM empresas_contador ec
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'company_id', company_id,
        'razao_social', razao_social,
        'cnpj', cnpj,
        'receita_mes', receita_mes,
        'inadimplencia', inadimplencia,
        'obrigacoes_proximas', obrigacoes_proximas,
        'alertas_ativos', alertas_ativos,
        'criticidade', CASE
          WHEN alertas_ativos > 0 OR obrigacoes_proximas > 2 THEN 'critica'
          WHEN inadimplencia > 0 OR obrigacoes_proximas > 0 THEN 'alerta'
          ELSE 'normal'
        END
      )
      ORDER BY
        CASE WHEN alertas_ativos > 0 THEN 0 ELSE 1 END,
        razao_social
    ),
    COUNT(*)::int,
    COALESCE(SUM(receita_mes), 0),
    COALESCE(SUM(inadimplencia), 0),
    COALESCE(SUM(obrigacoes_proximas), 0)::int
  INTO v_empresas, v_total_empresas, v_total_receita_mes, v_total_inadimplencia, v_total_obrigacoes_vencer
  FROM metricas;

  -- Alertas críticos consolidados (top 10)
  WITH empresas_contador AS (
    SELECT cc.company_id AS empresa_id FROM contador_clientes cc
    WHERE cc.contador_id = p_contador_id AND COALESCE(cc.ativo, true) = true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'empresa_id', a.company_id,
      'tipo', a.tipo,
      'mensagem', a.mensagem,
      'criticidade', a.urgencia,
      'criado_em', a.created_at
    )
    ORDER BY a.created_at DESC
  )
  INTO v_alertas_criticos
  FROM alertas_contador a
  WHERE a.company_id IN (SELECT empresa_id FROM empresas_contador)
    AND COALESCE(a.lido, false) = false
  LIMIT 10;

  -- Registrar acesso (LGPD audit)
  INSERT INTO contador_acessos_log (contador_id, acao, created_at)
  VALUES (p_contador_id, 'consulta_painel', NOW());

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_empresas', COALESCE(v_total_empresas, 0),
      'receita_consolidada_mes', v_total_receita_mes,
      'inadimplencia_consolidada', v_total_inadimplencia,
      'obrigacoes_proximas_7d', v_total_obrigacoes_vencer
    ),
    'empresas', COALESCE(v_empresas, '[]'::jsonb),
    'alertas_criticos', COALESCE(v_alertas_criticos, '[]'::jsonb)
  );
END;
$function$;

-- ============================================================================
-- Guardas estruturais (check_fn_guards · revoke_anon): as funções SECURITY DEFINER
-- do contador não são rota pública. REVOKE anon/PUBLIC + GRANT explícito.
-- (fn_psgc_balanco_gerencial é STABLE, NÃO é SECURITY DEFINER → roda sob RLS, sem REVOKE.)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_contador_resumo_competencia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contador_resumo_competencia(uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_ge_painel_contador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_painel_contador(uuid) TO authenticated, service_role;
