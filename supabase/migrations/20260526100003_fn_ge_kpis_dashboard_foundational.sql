-- fn_ge_kpis_dashboard foundational
-- Aplicado via MCP apply_migration 26/05/2026 · rastreio histórico
--
-- Causa raiz BUG #2 (KPIs hero zerados): RPC lia erp_lancamentos (tabela
-- vazia pra PS LTDA). Dados reais estão em erp_receber/erp_pagar (7
-- inadimplentes PS LTDA · R$ 11.500).
-- Shape JSON IDÊNTICO ao anterior · zero quebra no frontend.
-- Validado: PS LTDA agora retorna kpi_saldo_total=25084.93 e
-- kpi_receber_vencido={qtd:7, valor:11500}.

CREATE OR REPLACE FUNCTION public.fn_ge_kpis_dashboard(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_receber_vencido jsonb;
  v_receber_hoje jsonb;
  v_receber_mes jsonb;
  v_pagar_vencido jsonb;
  v_saldo_total jsonb;
  v_saldo_valor numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH base AS (
    SELECT categoria, valor
    FROM erp_receber
    WHERE company_id = p_company_id
      AND status = 'aberto'
      AND data_vencimento < CURRENT_DATE
  ),
  totais AS (SELECT SUM(valor) AS total, COUNT(*) AS qtd FROM base),
  top_cat AS (
    SELECT categoria, SUM(valor) AS valor
    FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2
  )
  SELECT jsonb_build_object(
    'valor', COALESCE((SELECT total FROM totais), 0),
    'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb)
  ) INTO v_receber_vencido;

  WITH base AS (
    SELECT valor FROM erp_receber
    WHERE company_id = p_company_id
      AND status = 'aberto' AND data_vencimento = CURRENT_DATE
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor), 0),
    'qtd', COUNT(*),
    'restante_mes', (
      SELECT COALESCE(SUM(valor), 0) FROM erp_receber
      WHERE company_id = p_company_id
        AND status = 'aberto'
        AND data_vencimento BETWEEN CURRENT_DATE + 1
          AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
    )
  ) INTO v_receber_hoje FROM base;

  WITH base AS (
    SELECT valor FROM erp_receber
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE
        AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
    UNION ALL
    SELECT valor FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE
        AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor), 0),
    'qtd', COUNT(*)
  ) INTO v_receber_mes FROM base;

  WITH base AS (
    SELECT categoria, valor, data_vencimento
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento < CURRENT_DATE
  ),
  top_cat AS (
    SELECT categoria, SUM(valor) AS valor
    FROM base GROUP BY categoria ORDER BY valor DESC LIMIT 2
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor), 0),
    'qtd', COUNT(*),
    'dias_max_atraso', COALESCE(MAX(CURRENT_DATE - data_vencimento), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb)
  ) INTO v_pagar_vencido FROM base;

  v_saldo_valor := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT jsonb_build_object(
    'valor', v_saldo_valor,
    'limite_credito', 0,
    'disponivel_total', v_saldo_valor,
    'qtd_contas', COUNT(*)
  ) INTO v_saldo_total
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true AND COALESCE(soma_no_saldo, true) = true;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'kpi_receber_vencido', v_receber_vencido,
    'kpi_vencem_hoje', v_receber_hoje,
    'kpi_vencer_mes', v_receber_mes,
    'kpi_pagar_vencido', v_pagar_vencido,
    'kpi_saldo_total', v_saldo_total
  );
END;
$$;
