-- ============================================================
-- PR-FIX HOME GE · FASE 3 — saldo com UMA definição só + "a vencer" desambiguado.
--
-- (1) SALDO FANTASMA na raiz: fn_psgc_painel_operacional calculava saldo por
--     conta_bancaria (TEXTO livre do lançamento) como entradas−saídas pagas,
--     SEM saldo_inicial → dava um número divergente (-15.238,97 / "1 conta")
--     do resto da tela (-23.870,71 / 3). Agora usa a MESMA fonte canônica do
--     fn_ge_contas_resumo (fn_saldo_bancos_dinamico + rateio por saldo_inicial
--     nas contas de erp_banco_contas). Um saldo só no sistema inteiro.
--
-- (2) "A VENCER ESTE MÊS" misturava receber + pagar (24.033,96 = 14.717,89 a
--     receber + 9.316 a pagar). O card é de recebíveis (rota /contas-receber),
--     então passa a somar SÓ receber. Bate com "entradas".
-- ============================================================

-- (2) fn_ge_kpis_dashboard · kpi_vencer_mes = SÓ receber ------------------------
CREATE OR REPLACE FUNCTION public.fn_ge_kpis_dashboard(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_receber_vencido jsonb; v_receber_hoje jsonb; v_receber_mes jsonb;
  v_pagar_vencido jsonb; v_saldo_total jsonb; v_saldo_valor numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH base AS (
    SELECT categoria, valor FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE),
  totais AS (SELECT SUM(valor) AS total, COUNT(*) AS qtd FROM base),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE((SELECT total FROM totais), 0), 'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_receber_vencido;

  WITH base AS (SELECT valor FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento = CURRENT_DATE)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'restante_mes', (SELECT COALESCE(SUM(valor), 0) FROM erp_receber
      WHERE company_id = p_company_id AND status IN ('aberto','vencido')
        AND data_vencimento BETWEEN CURRENT_DATE + 1 AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))
  INTO v_receber_hoje FROM base;

  -- ✅ SÓ RECEBER (antes: UNION com erp_pagar → "a vencer" misturava entrada e saída)
  WITH base AS (
    SELECT valor FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('aberto','vencido')
      AND data_vencimento BETWEEN CURRENT_DATE AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes FROM base;

  WITH base AS (
    SELECT categoria, valor, data_vencimento FROM erp_pagar
    WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'dias_max_atraso', COALESCE(MAX(CURRENT_DATE - data_vencimento), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_pagar_vencido FROM base;

  v_saldo_valor := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT jsonb_build_object('valor', v_saldo_valor, 'limite_credito', 0, 'disponivel_total', v_saldo_valor, 'qtd_contas', COUNT(*))
  INTO v_saldo_total FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true AND COALESCE(soma_no_saldo, true) = true;

  RETURN jsonb_build_object('company_id', p_company_id,
    'kpi_receber_vencido', v_receber_vencido, 'kpi_vencem_hoje', v_receber_hoje,
    'kpi_vencer_mes', v_receber_mes, 'kpi_pagar_vencido', v_pagar_vencido, 'kpi_saldo_total', v_saldo_total);
END; $function$;

-- (1) fn_psgc_painel_operacional · saldos_bancarios CANÔNICO --------------------
CREATE OR REPLACE FUNCTION public.fn_psgc_painel_operacional(p_company_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_fim_30d date := CURRENT_DATE + INTERVAL '30 days';
  v_fim_mes date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_receber_vencidos jsonb; v_receber_hoje jsonb; v_receber_30d jsonb; v_receber_mes jsonb;
  v_pagar_vencidos jsonb; v_pagar_hoje jsonb; v_pagar_30d jsonb; v_pagar_mes jsonb;
  v_saldos_bancarios jsonb; v_saldo_total numeric;
  v_qtd_contas_c int; v_soma_iniciais numeric;
  v_conciliacoes_qtd int; v_conciliacoes_valor numeric; v_alertas_imediatos jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('erro', 'sem_empresas');
  END IF;

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_receber_vencidos FROM (
    SELECT cliente_nome, valor, data_vencimento FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_receber_hoje FROM (
    SELECT cliente_nome, valor FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_30d
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_pagar_vencidos FROM (
    SELECT fornecedor_nome, valor, data_vencimento FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_pagar_hoje FROM (
    SELECT fornecedor_nome, valor FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_30d
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));

  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_mes
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));

  -- SALDOS BANCÁRIOS · fonte canônica (igual fn_ge_contas_resumo)
  v_saldo_total := fn_saldo_bancos_dinamico(p_company_ids);
  SELECT COUNT(*), COALESCE(SUM(COALESCE(saldo_inicial,0)),0) INTO v_qtd_contas_c, v_soma_iniciais
  FROM erp_banco_contas WHERE company_id = ANY(p_company_ids) AND ativo = true AND COALESCE(soma_no_saldo, true) = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conta', bc.nome,
      'saldo', CASE WHEN v_qtd_contas_c = 1 THEN v_saldo_total
                    WHEN v_soma_iniciais > 0 THEN ROUND(v_saldo_total * (COALESCE(bc.saldo_inicial,0)/v_soma_iniciais), 2)
                    ELSE ROUND(v_saldo_total / NULLIF(v_qtd_contas_c,0), 2) END,
      'entradas_acum', 0, 'saidas_acum', 0, 'ultima_movimentacao', bc.updated_at
    ) ORDER BY bc.nome), '[]'::jsonb)
  INTO v_saldos_bancarios
  FROM erp_banco_contas bc WHERE bc.company_id = ANY(p_company_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true;

  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_conciliacoes_qtd, v_conciliacoes_valor
  FROM (
    SELECT valor FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    UNION ALL
    SELECT valor FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
  ) pendentes;

  WITH criticos AS (
    SELECT 'pagar' AS tipo, 'critico' AS severidade, fornecedor_nome AS pessoa, valor, data_vencimento,
      (CURRENT_DATE - data_vencimento) AS dias_atraso,
      CASE WHEN (CURRENT_DATE - data_vencimento) > 90 THEN '🚨 Vencido há +90 dias — risco de protesto'
           WHEN (CURRENT_DATE - data_vencimento) > 30 THEN '⚠️ Vencido há +30 dias — juros/multa acumulando'
           ELSE '📅 Vencido recentemente' END AS mensagem
    FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC, valor DESC LIMIT 5)
  SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'severidade', severidade, 'pessoa', pessoa,
    'valor', valor, 'vencimento', data_vencimento, 'dias_atraso', dias_atraso, 'mensagem', mensagem))
  INTO v_alertas_imediatos FROM criticos;

  RETURN jsonb_build_object('gerado_em', NOW(), 'data_referencia', v_hoje,
    'empresas_consideradas', array_length(p_company_ids, 1),
    'cards_hero', jsonb_build_object(
      'receber_vencidos', v_receber_vencidos, 'receber_hoje', v_receber_hoje,
      'receber_30d', v_receber_30d, 'receber_resto_mes', v_receber_mes,
      'pagar_vencidos', v_pagar_vencidos, 'pagar_hoje', v_pagar_hoje,
      'pagar_30d', v_pagar_30d, 'pagar_resto_mes', v_pagar_mes),
    'saldos_bancarios', jsonb_build_object(
      'total', COALESCE(ROUND(v_saldo_total::numeric, 2), 0),
      'qtd_contas', COALESCE(jsonb_array_length(v_saldos_bancarios), 0),
      'contas', COALESCE(v_saldos_bancarios, '[]'::jsonb)),
    'conciliacoes_pendentes', jsonb_build_object('qtd', v_conciliacoes_qtd, 'valor_estimado', ROUND(v_conciliacoes_valor::numeric, 2)),
    'alertas_imediatos', COALESCE(v_alertas_imediatos, '[]'::jsonb));
END; $function$;
