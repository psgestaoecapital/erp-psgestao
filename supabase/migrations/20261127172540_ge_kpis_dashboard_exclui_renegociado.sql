-- PDCA GE · /dashboard/gestao-empresarial (home/dashboard da GE)
-- CORRECTNESS NÚCLEO: KPIs de recebíveis contam título RENEGOCIADO (fantasma).
-- Fonte: fn_ge_kpis_dashboard (KpisDashboard.tsx / DashboardRico.tsx).
--
-- RAIZ (RD-38, mesma classe da #6036 resultado-por-negócio): os ramos de
--   recebível (vencido / vencem hoje / restante do mês / vencer no mês) filtram
--   status NOT IN ('recebido','pago','cancelado) e NÃO excluem 'renegociado'.
--   Quando um título é renegociado o ORIGINAL continua vivo (deleted_at IS NULL,
--   status='renegociado') e nascem os títulos-filho que o substituem → o original
--   inflava kpi_receber_vencido / kpi_vencem_hoje / kpi_vencer_mes.
--   fn_fluxo_caixa_diario e a #6036 já excluem 'renegociado'; esta ficou de fora.
--   (v_receber_efetivo só exclui 'previsto' — o status precisa ser barrado aqui.)
--   Corrobora o chamado de cliente #5673 ("renegociado só na tela de Renegociação").
--
-- PROVA RD-38 (DEMO GE b0700000-0000-4000-a000-000000000004, hoje, BEGIN/ROLLBACK):
--   kpi_receber_vencido ATUAL (com bug)              = R$ 25.292,51 (25 títulos)
--   kpi_receber_vencido CORRIGIDO (exclui renegociado)= R$ 22.322,51 (23 títulos)
--   diferença = R$ 2.970,00 = os 2 títulos 'renegociado' da DEMO, já substituídos
--   por títulos 'aberto' (renegociação edfce16e). Fantasma.
--
-- PAGAR: NÃO alterado. Prova no dado: erp_pagar não possui NENHUM título com
--   status like '%reneg%' (0 linhas), então o ramo kpi_pagar_vencido é correto
--   como está (status NOT IN ('pago','cancelado')).
--
-- Fix pontual, aditivo, leitura, sem tocar estrutura nem dado de cliente: só
--   acrescenta 'renegociado' às exclusões de status dos 4 ramos de recebível.

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
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  -- RECEBER vencido: em aberto (não recebido/pago/cancelado/renegociado) e vencido por DATA. valor = valor - pago.
  WITH base AS (
    SELECT categoria, (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor
    FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado','renegociado') AND data_vencimento < CURRENT_DATE),
  totais AS (SELECT SUM(valor) AS total, COUNT(*) AS qtd FROM base),
  top_cat AS (SELECT categoria, SUM(valor) AS valor FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2)
  SELECT jsonb_build_object('valor', COALESCE((SELECT total FROM totais), 0), 'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb))
  INTO v_receber_vencido;
  -- RECEBER vencendo hoje (+ restante do mês).
  WITH base AS (SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado','renegociado') AND data_vencimento = CURRENT_DATE)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'restante_mes', (SELECT COALESCE(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 0) FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
      WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado','renegociado')
        AND data_vencimento BETWEEN CURRENT_DATE + 1 AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))
  INTO v_receber_hoje FROM base;
  WITH base AS (
    SELECT (COALESCE(valor,0) - COALESCE(valor_pago,0)) AS valor FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status NOT IN ('recebido','pago','cancelado','renegociado')
      AND data_vencimento BETWEEN CURRENT_DATE AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date)
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes FROM base;
  -- PAGAR vencido: em aberto (não pago/cancelado — erp_pagar não tem status 'vencido' nem 'renegociado') e vencido por DATA.
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

-- Guarda de acesso (check_fn_guards · [revoke_anon]): CREATE OR REPLACE não mexe
-- nos grants; o bloco só reafirma a ACL VIVA (authenticated + service_role),
-- sem ampliar acesso.
REVOKE ALL ON FUNCTION public.fn_ge_kpis_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_kpis_dashboard(uuid) TO authenticated, service_role;
