-- Fix (RD-51/57/58): o dashboard de Gestão Empresarial lia lançamentos soft-deletados
-- (deleted_at preenchido) porque as RPCs NÃO filtravam deleted_at IS NULL.
--
-- Provado no tenant Estância Umuarama (636af107-...): uma receita de R$60.000 EXCLUÍDA hoje
-- (erp_receber 0048a012..., deleted_at != null) aparecia em:
--   • fn_ge_next_best_action  → alerta "Cobre os vencidos · maior risco da carteira".
--   • fn_psgc_painel_operacional.cards_hero.receber_vencidos (R$60.000), .alertas_imediatos
--     (a despesa deletada de R$2.000) e .conciliacoes_pendentes (R$62.000 = 60k+2k).
--
-- Correção de LEITURA apenas (nenhum dado tocado): adiciona `AND deleted_at IS NULL` em TODOS os
-- SELECTs sobre erp_receber/erp_pagar dessas duas funções (RD-57: todos os caminhos, não só um).
-- Assinaturas e retornos preservados (RD-52).

-- ── 1) Painel operacional (cards_hero, conciliações e alertas do dashboard GE) ──
CREATE OR REPLACE FUNCTION public.fn_psgc_painel_operacional(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_fim_30d date := CURRENT_DATE + INTERVAL '30 days';
  v_fim_mes date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_receber_vencidos jsonb; v_receber_hoje jsonb; v_receber_30d jsonb; v_receber_mes jsonb;
  v_pagar_vencidos jsonb; v_pagar_hoje jsonb; v_pagar_30d jsonb; v_pagar_mes jsonb;
  v_saldos_bancarios jsonb; v_saldo_total numeric;
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
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_receber_hoje FROM (
    SELECT cliente_nome, valor FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_30d
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_pagar_vencidos FROM (
    SELECT fornecedor_nome, valor, data_vencimento FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_pagar_hoje FROM (
    SELECT fornecedor_nome, valor FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje AND deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_30d
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_mes
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes AND deleted_at IS NULL
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));

  SELECT COALESCE(SUM(COALESCE(saldo_atual,0)),0) INTO v_saldo_total
  FROM erp_banco_contas WHERE company_id = ANY(p_company_ids) AND ativo = true AND COALESCE(soma_no_saldo, true) = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conta', bc.nome,
      'saldo', ROUND(COALESCE(bc.saldo_atual,0), 2),
      'entradas_acum', 0, 'saidas_acum', 0, 'ultima_movimentacao', bc.updated_at
    ) ORDER BY bc.nome), '[]'::jsonb)
  INTO v_saldos_bancarios
  FROM erp_banco_contas bc WHERE bc.company_id = ANY(p_company_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true;

  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_conciliacoes_qtd, v_conciliacoes_valor
  FROM (
    SELECT valor FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL AND deleted_at IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    UNION ALL
    SELECT valor FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL AND deleted_at IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
  ) pendentes;
  WITH criticos AS (
    SELECT 'pagar' AS tipo, 'critico' AS severidade, fornecedor_nome AS pessoa, valor, data_vencimento,
      (CURRENT_DATE - data_vencimento) AS dias_atraso,
      CASE WHEN (CURRENT_DATE - data_vencimento) > 90 THEN '🚨 Vencido há +90 dias — risco de protesto'
           WHEN (CURRENT_DATE - data_vencimento) > 30 THEN '⚠️ Vencido há +30 dias — juros/multa acumulando'
           ELSE '📅 Vencido recentemente' END AS mensagem
    FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje AND deleted_at IS NULL
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

-- ── 2) Next Best Action (o alerta "Cobre os vencidos / maior risco da carteira") ──
CREATE OR REPLACE FUNCTION public.fn_ge_next_best_action(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_saldo numeric; v_rec record; v_pag record; v_qtd_conciliacoes_pendentes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'caixa', 'titulo', 'Caixa no vermelho',
      'texto', 'Saldo bancario consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G990D00') || '. Priorize entradas e segure pagamentos nao criticos.',
      'cta_principal', 'Ver contas bancarias', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/contas-bancarias', 'rota_secundaria', '/dashboard/consultor-ia?contexto=caixa');
  END IF;
  SELECT cliente_nome, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_rec
  FROM erp_receber WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL
  GROUP BY cliente_nome ORDER BY MAX(CURRENT_DATE - data_vencimento) DESC, SUM(valor) DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'cobranca', 'titulo', 'Cobre os vencidos',
      'texto', 'Cobrar ' || COALESCE(v_rec.cliente_nome,'cliente') || ' — atrasado ha ' || v_rec.dias || ' dias, R$ ' || TO_CHAR(v_rec.valor,'FM999G999G990D00') || '. Maior risco da carteira.',
      'cta_principal', 'Ver inadimplentes', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/inadimplentes', 'rota_secundaria', '/dashboard/consultor-ia?contexto=cobranca');
  END IF;
  SELECT COUNT(*) AS qtd, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_pag
  FROM erp_pagar WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL;
  IF v_pag.qtd > 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'pagamento', 'titulo', 'Contas a pagar vencidas',
      'texto', v_pag.qtd || ' conta(s) vencida(s), R$ ' || TO_CHAR(v_pag.valor,'FM999G999G990D00') || ' · maior atraso ' || v_pag.dias || ' dia(s). Regularize pra evitar juros/negativacao.',
      'cta_principal', 'Ver contas a pagar', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/pagar?filtro=vencido', 'rota_secundaria', '/dashboard/consultor-ia');
  END IF;
  SELECT COUNT(*) INTO v_qtd_conciliacoes_pendentes
  FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
  WHERE bc.company_id = p_company_id AND cl.status = 'pendente';
  IF v_qtd_conciliacoes_pendentes > 10 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'conciliacao', 'titulo', 'Concilie o extrato',
      'texto', 'Voce tem ' || v_qtd_conciliacoes_pendentes || ' conciliacoes bancarias pendentes. Resolver isso corrige seus KPIs.',
      'cta_principal', 'Conciliar agora', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/conciliacao', 'rota_secundaria', '/dashboard/consultor-ia?contexto=conciliacao');
  END IF;
  RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'estavel', 'titulo', 'Tudo em dia',
    'texto', 'Sem acoes urgentes detectadas. Aproveite pra planejar o proximo mes ou revisar contratos recorrentes.',
    'cta_principal', 'Ver contratos recorrentes', 'cta_secundario', 'Falar com IA',
    'rota_principal', '/dashboard/contratos-recorrentes', 'rota_secundaria', '/dashboard/consultor-ia');
END; $function$;
