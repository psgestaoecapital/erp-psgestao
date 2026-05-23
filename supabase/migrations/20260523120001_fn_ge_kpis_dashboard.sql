-- PR 2 · Função 2/6: 5 KPIs do Dashboard GE com breakdown.
-- IPO #35: erp_banco_contas NÃO tem `limite_credito` — mantemos a chave no
-- contrato JSON (frontend) com valor 0. erp_lancamentos.data_* são text.

CREATE OR REPLACE FUNCTION public.fn_ge_kpis_dashboard(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_receber_vencido jsonb;
  v_receber_hoje jsonb;
  v_receber_mes jsonb;
  v_pagar_vencido jsonb;
  v_saldo_total jsonb;
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
    SELECT categoria, valor_documento
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo = 'receber'
      AND status != 'pago'
      AND NULLIF(data_vencimento,'')::date < CURRENT_DATE
  ),
  totais AS (
    SELECT SUM(valor_documento) AS total, COUNT(*) AS qtd FROM base
  ),
  top_cat AS (
    SELECT categoria, SUM(valor_documento) AS valor
    FROM base
    GROUP BY categoria
    ORDER BY valor DESC
    LIMIT 2
  )
  SELECT jsonb_build_object(
    'valor', COALESCE((SELECT total FROM totais), 0),
    'qtd', COALESCE((SELECT qtd FROM totais), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb)
  ) INTO v_receber_vencido;

  WITH base AS (
    SELECT valor_documento
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo = 'receber'
      AND status != 'pago'
      AND NULLIF(data_vencimento,'')::date = CURRENT_DATE
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor_documento), 0),
    'qtd', COUNT(*),
    'restante_mes', (
      SELECT COALESCE(SUM(valor_documento), 0)
      FROM erp_lancamentos
      WHERE company_id = p_company_id
        AND tipo = 'receber'
        AND status != 'pago'
        AND NULLIF(data_vencimento,'')::date BETWEEN CURRENT_DATE + 1 AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
    )
  ) INTO v_receber_hoje
  FROM base;

  WITH base AS (
    SELECT categoria, valor_documento
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo IN ('receber', 'pagar')
      AND status != 'pago'
      AND NULLIF(data_vencimento,'')::date >= CURRENT_DATE
      AND NULLIF(data_vencimento,'')::date <= (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor_documento), 0),
    'qtd', COUNT(*)
  ) INTO v_receber_mes
  FROM base;

  WITH base AS (
    SELECT categoria, valor_documento, NULLIF(data_vencimento,'')::date AS dv
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo = 'pagar'
      AND status != 'pago'
      AND NULLIF(data_vencimento,'')::date < CURRENT_DATE
  ),
  top_cat AS (
    SELECT categoria, SUM(valor_documento) AS valor
    FROM base
    GROUP BY categoria
    ORDER BY valor DESC
    LIMIT 2
  )
  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(valor_documento), 0),
    'qtd', COUNT(*),
    'dias_max_atraso', COALESCE(MAX(CURRENT_DATE - dv), 0),
    'breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', valor)) FROM top_cat), '[]'::jsonb)
  ) INTO v_pagar_vencido
  FROM base;

  SELECT jsonb_build_object(
    'valor', COALESCE(SUM(saldo_atual), 0),
    'limite_credito', 0,
    'disponivel_total', COALESCE(SUM(saldo_atual), 0),
    'qtd_contas', COUNT(*)
  ) INTO v_saldo_total
  FROM erp_banco_contas
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'kpi_receber_vencido', v_receber_vencido,
    'kpi_vencem_hoje', v_receber_hoje,
    'kpi_vencer_mes', v_receber_mes,
    'kpi_pagar_vencido', v_pagar_vencido,
    'kpi_saldo_total', v_saldo_total
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_kpis_dashboard(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_kpis_dashboard(uuid) IS
'5 KPIs do Dashboard GE com breakdown. Universal RD-38. PR 2 23/05/2026.';
