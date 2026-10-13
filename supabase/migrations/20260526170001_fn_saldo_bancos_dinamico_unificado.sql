-- PR-FIX-SALDO-UNIFICADO (CEO 26/05/2026 · cristalização banco dc2b46f4)
-- Aplicado via MCP apply_migration · rastreio histórico.
--
-- BUG FOUNDATIONAL: 2 RPCs divergem
--   fn_ge_contas_resumo retornava R$ 25.084 (PS LTDA)
--   fn_ge_extrato_conta retornava R$ 233.711 (PS LTDA)
--   Stephany via 2 números diferentes pra mesmo saldo Sicoob.
--
-- CAUSA RAIZ (descoberta via execute_sql · 100% dos lançamentos):
--   125 erp_receber pagos PS LTDA · TODOS com conta_bancaria NULL
--   318 erp_pagar pagos PS LTDA · TODOS com conta_bancaria NULL
--   Match por bc.nome (PR #163) retornava 0 movimentos · resultado =
--   só saldo_inicial bancário (R$ 25.084).
--   fn_ge_extrato_conta ignora conta_bancaria · soma TODOS movimentos
--   (R$ 438.411 receber − R$ 204.700 pagar = R$ 233.711).
--
-- DECISÃO CEO Opção B: alinhar com fn_ge_extrato_conta.
--   Justificativa: importação trouxe TODO histórico desde inicio.
--   saldo_inicial bancário duplica os movimentos.
--   Nova fórmula: SUM(receber pago) − SUM(pagar pago)
--   (sem saldo_inicial · sem match por conta_bancaria).
--
-- VALIDAÇÃO PÓS-MIGRATION (4 fontes em uníssono):
--   PS LTDA:        fn_saldo_bancos_dinamico = fn_ge_contas_resumo.saldo_total
--                 = fn_ge_extrato_conta.saldo_atual
--                 = fn_ge_kpis_dashboard.kpi_saldo_total.valor = R$ 233.711,05
--   PS Consultoria: idem · R$ 113.394,70

CREATE OR REPLACE FUNCTION public.fn_saldo_bancos_dinamico(p_company_ids uuid[])
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(er.valor_pago, er.valor, 0))
      FROM erp_receber er
      WHERE er.company_id = ANY(p_company_ids)
        AND er.data_pagamento IS NOT NULL
        AND er.status IN ('recebido','pago')
    ), 0)
    - COALESCE((
      SELECT SUM(COALESCE(ep.valor_pago, ep.valor, 0))
      FROM erp_pagar ep
      WHERE ep.company_id = ANY(p_company_ids)
        AND ep.data_pagamento IS NOT NULL
        AND ep.status = 'pago'
    ), 0);
$$;
