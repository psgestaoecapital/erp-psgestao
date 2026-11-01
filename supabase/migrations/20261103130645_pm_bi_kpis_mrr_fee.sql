-- PDCA P&M · /dashboard/pm (BI da Agência) · aud8 82/95
-- GAP RD-98 p1 (dado real): o KPI headline "MRR" de fn_pm_bi_kpis somava
-- erp_contratos.valor_mensal (contratos ERP genéricos) em vez do fee recorrente
-- da agência. Na DEMO P&M (-002): mostrava R$2.198 em vez dos R$13.800 reais dos
-- 5 fees ativos. Os fees da agência vivem em agency_contratos.fee_mensal e NÃO
-- estão vinculados ao ERP (erp_contrato_id NULL), então o ERP nunca refletia o MRR.
--
-- INCONSISTÊNCIA DENTRO DO PRÓPRIO HUB: fn_pm_bi_series já usa fee_mensal nos
-- gráficos "Top clientes por MRR"/"Margem por cliente"; /contratos (Fees) e
-- /comercial também leem agency_contratos. Só o KPI do topo divergia.
--
-- CORREÇÃO: fonte única do MRR da agência = agency_contratos.fee_mensal
-- (status='ativo'), alinhando o KPI ao series e às telas de contratos.
-- Aditiva/comportamental: só muda a origem do v_mrr; demais KPIs, guardas
-- (is_admin + get_user_company_ids) e empty_state intactos.
--
-- Prova (dado, 01/11): company -002 mrr_antigo=2198 -> mrr_novo=13800;
-- company 36b69d77 10300 -> 7200. Ambas passam a refletir o fee recorrente real.
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
  -- MRR = fee recorrente da agência (agency_contratos), fonte única alinhada ao
  -- fn_pm_bi_series e às telas /contratos e /comercial.
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

-- Reafirma a ACL da função SECURITY DEFINER (gate check-fn-guards / [revoke_anon]).
-- CREATE OR REPLACE só preserva a ACL onde a função já existe; em ambiente novo
-- volta ao default EXECUTE TO PUBLIC. Espelha a ACL viva ({authenticated, service_role}).
REVOKE ALL ON FUNCTION public.fn_pm_bi_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_kpis(uuid[]) TO authenticated, service_role;
