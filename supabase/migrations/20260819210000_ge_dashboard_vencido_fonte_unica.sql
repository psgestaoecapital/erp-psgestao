-- GE Dashboard · "vencido" com FONTE ÚNICA por DATA (RD-52). Reportado por Jordana (KGF).
--
-- Diagnóstico auditado (RD-38, 19/08):
--  • Card "A PAGAR VENCIDO" mostrava R$111,82 (1 título) — erro grave. Causa: fn_ge_kpis_dashboard
--    filtrava status IN ('aberto','vencido'), mas erp_pagar NÃO tem status 'vencido' (usa aberto,
--    agendado, incluido_remessa, pago). Assim quase nada entrava.
--  • Faixa de alertas do topo (fn_alertas_gerar_automaticos) contava títulos SOFT-DELETED
--    (deleted_at preenchido) → superava (7/8) enquanto cards/Saúde (que excluem deletados) davam 5/6.
--
-- Decisão CEO (RD-52): "vencido" = deleted_at IS NULL AND status NOT IN (pagos/cancelados)
--    AND data_vencimento < current_date; valor em aberto = valor - coalesce(valor_pago,0).
--    Deletados NÃO contam. Alvo KGF: receber 5 · R$4.965,06 · pagar 6 · R$3.496,77.
--
-- Escopo: recria fn_ge_kpis_dashboard (cards) e fn_alertas_gerar_automaticos (faixa topo).
-- fn_ge_saude_financeira e fn_ge_top_inadimplentes já excluem deletados e já batem em 5 — não tocadas.

-- ── Cards do dashboard (KpisDashboard) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ge_kpis_dashboard(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receber_vencido jsonb; v_receber_hoje jsonb; v_receber_mes jsonb;
  v_pagar_vencido jsonb; v_saldo_total jsonb; v_saldo_valor numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  -- RECEBER vencido: em aberto (não recebido/pago/cancelado) e vencido por DATA. valor = valor - pago.
  WITH base AS (
    SELECT categoria, (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado') AND data_vencimento < CURRENT_DATE),
  totais AS (SELECT SUM(valor) AS total, COUNT(*) AS qtd FROM base),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE((SELECT total FROM totais), 0), 'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_receber_vencido;
  -- RECEBER vencendo hoje (+ restante do mês).
  WITH base AS (SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado') AND data_vencimento = CURRENT_DATE)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'restante_mes', (SELECT COALESCE(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 0) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
      WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado')
        AND data_vencimento BETWEEN CURRENT_DATE + 1 AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))
  INTO v_receber_hoje FROM base;
  WITH base AS (
    SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado')
      AND data_vencimento BETWEEN CURRENT_DATE AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes FROM base;
  -- PAGAR vencido: em aberto (não pago/cancelado — erp_pagar não tem status 'vencido') e vencido por DATA.
  WITH base AS (
    SELECT categoria, (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor, data_vencimento FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
    WHERE company_id = p_company_id AND status NOT IN ('pago','cancelado') AND data_vencimento < CURRENT_DATE),
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

-- ── Faixa de alertas do topo — só faltava excluir soft-deleted (deleted_at) ────
CREATE OR REPLACE FUNCTION public.fn_alertas_gerar_automaticos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo numeric;
BEGIN
  DELETE FROM erp_alerta_proativo
  WHERE company_id = p_company_id
    AND tipo IN ('vencimento_hoje','inadimplencia_critica','saldo_negativo','receber_vencido','pagar_vencido');

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'receber_vencido',
    CASE WHEN MAX(CURRENT_DATE - data_vencimento) > 30 THEN 'critica' ELSE 'alta' END,
    'A receber vencido',
    COUNT(*) || ' cobranca(s) vencida(s) · R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00') ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/inadimplentes'
  FROM erp_receber
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('recebido','pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'pagar_vencido', 'alta',
    'A pagar vencido',
    COUNT(*) || ' conta(s) vencida(s) · R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00') ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/pagar?filtro=vencido'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'vencimento_hoje', 'alta',
    'A pagar hoje',   -- explícito: este alerta é de contas A PAGAR vencendo hoje (o card "A receber hoje" é o outro lado)
    'Voce tem ' || COUNT(*) || ' conta(s) a pagar vencendo hoje totalizando R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00'),
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))),
    '/dashboard/financeiro/pagar?vencendo=hoje'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento = CURRENT_DATE
  HAVING COUNT(*) > 0;

  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'saldo_negativo', 'critica',
      'Saldo bancario negativo',
      'Saldo consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G999D00') || '. Caixa no vermelho.',
      jsonb_build_object('saldo', v_saldo),
      '/dashboard/contas-bancarias');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'gerados', (SELECT COUNT(*) FROM erp_alerta_proativo WHERE company_id = p_company_id AND NOT resolvido AND NOT dispensado));
END; $function$;
