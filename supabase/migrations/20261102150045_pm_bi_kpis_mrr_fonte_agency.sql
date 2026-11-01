-- PDCA P&M · /dashboard/pm (BI da Agência) · aud8 82/95 · GAP 1 (RD-98 p1: dado real)
-- Code: desenvolvedor_4_g
--
-- O KPI HEADLINE "MRR (receita recorrente)" vinha da FONTE ERRADA:
-- fn_pm_bi_kpis.mrr somava erp_contratos.valor_mensal (status 'ativo'), que na
-- empresa P&M DEMO (b0700000-0000-4000-a000-000000000002) dá R$ 2.198,00 — apenas
-- 3 contratos ERP genéricos. O MRR REAL da agência está em agency_contratos.fee_mensal
-- (status 'ativo') = R$ 13.800,00: os 5 fees recorrentes ativos
--   Clínica Sorriso Vale 3500 + Café Serra Azul 3200 + [BOT] Cliente Agência 2800
--   + Pet Amigo 2500 + Academia Pulso 1800 = 13.800,00
-- (todos com erp_contrato_id NULL — nunca refletidos no ERP).
--
-- As telas /dashboard/pm/contratos (Fees) e /dashboard/pm/comercial e os gráficos
-- de fn_pm_bi_series já leem o fee da agência; só o KPI do topo divergia.
-- Esta migration alinha o KPI com a fonte única de MRR da agência (agency_contratos).
--
-- Aditiva: apenas CREATE OR REPLACE da função existente (sem DDL destrutivo, sem
-- alterar RLS/grants). A função mantém SECURITY DEFINER + guarda por company
-- (is_admin()/get_user_company_ids()) e search_path='public', inalterados.

CREATE OR REPLACE FUNCTION public.fn_pm_bi_kpis(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; v_mrr numeric; v_cli int; v_jobs int; v_horas numeric; v_com numeric; v_venc numeric;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;
  -- MRR da agência = soma dos fees mensais recorrentes ativos (fonte única: agency_contratos)
  SELECT COALESCE(sum(fee_mensal),0) INTO v_mrr FROM agency_contratos
    WHERE company_id = ANY(p_company_ids) AND status='ativo';
  SELECT count(*) INTO v_cli FROM agency_clientes
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo';
  SELECT count(*) INTO v_jobs FROM agency_jobs
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') NOT IN ('concluido','entregue','cancelado','arquivado')
      AND excluido_em IS NULL;
  SELECT COALESCE(sum(horas),0) INTO v_horas FROM agency_timesheet
    WHERE company_id = ANY(p_company_ids) AND data >= date_trunc('month', current_date)::date;
  SELECT COALESCE(sum(valor_comissao),0) INTO v_com FROM agency_comissao
    WHERE company_id = ANY(p_company_ids) AND status IN ('prevista','a_pagar');
  SELECT COALESCE(sum(valor - COALESCE(valor_pago,0)),0) INTO v_venc FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') <> 'pago'
      AND data_vencimento < current_date AND deleted_at IS NULL;
  v := jsonb_build_object('empty_state', false,
    'mrr', v_mrr, 'clientes_ativos', v_cli, 'jobs_andamento', v_jobs,
    'horas_mes', v_horas, 'comissao_pagar', v_com, 'receber_vencido', v_venc);
  RETURN v;
END $function$;
