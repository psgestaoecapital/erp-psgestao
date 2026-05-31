-- fn_dashboard_kpis foundational: usa helper saldo dinâmico
-- Aplicado via MCP apply_migration 26/05/2026 · rastreio histórico
-- Validado: PS LTDA retorna saldo_bancos=25084.93 (era 0)

CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis(p_company_ids uuid[])
RETURNS TABLE(a_receber_valor numeric, a_receber_qtd bigint, a_pagar_valor numeric, a_pagar_qtd bigint, saldo_bancos numeric, mrr_mensal numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id = ANY(p_company_ids) AND status='aberto'), 0) AS a_receber_valor,
    COALESCE((SELECT COUNT(*)  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND status='aberto'), 0) AS a_receber_qtd,
    COALESCE((SELECT SUM(valor) FROM erp_pagar   WHERE company_id = ANY(p_company_ids) AND status='aberto'), 0) AS a_pagar_valor,
    COALESCE((SELECT COUNT(*)  FROM erp_pagar   WHERE company_id = ANY(p_company_ids) AND status='aberto'), 0) AS a_pagar_qtd,
    fn_saldo_bancos_dinamico(p_company_ids) AS saldo_bancos,
    COALESCE((SELECT SUM(
      COALESCE(valor_atual, valor_mensal, 0) * CASE periodicidade
        WHEN 'anual' THEN 1.0/12
        WHEN 'semestral' THEN 1.0/6
        WHEN 'trimestral' THEN 1.0/3
        WHEN 'bimestral' THEN 1.0/2
        ELSE 1
      END
    ) FROM erp_contratos WHERE company_id = ANY(p_company_ids) AND status='ativo'), 0) AS mrr_mensal
$$;
