-- DASHBOARD FOUNDATIONAL · helper saldo bancos dinâmico
-- CEO autorizou 26/05/2026 · cristalização erp_contexto_projeto eff2c97c
-- Aplicado via MCP apply_migration · este arquivo é rastreio histórico
--
-- Causa raiz: erp_banco_contas.saldo_atual = 0 (Sicoob PS LTDA tem
-- saldo_inicial=25084.93 mas saldo_atual=0). Calcula saldo dinâmico via
-- saldo_inicial + movimentos pagos em erp_receber/erp_pagar.

CREATE OR REPLACE FUNCTION public.fn_saldo_bancos_dinamico(p_company_ids uuid[])
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(
    COALESCE(bc.saldo_inicial, 0)
    + COALESCE((
        SELECT SUM(COALESCE(er.valor_pago, er.valor, 0))
        FROM erp_receber er
        WHERE er.company_id = bc.company_id
          AND er.conta_bancaria = bc.nome
          AND er.data_pagamento IS NOT NULL
          AND er.status IN ('recebido','pago')
      ), 0)
    - COALESCE((
        SELECT SUM(COALESCE(ep.valor_pago, ep.valor, 0))
        FROM erp_pagar ep
        WHERE ep.company_id = bc.company_id
          AND ep.conta_bancaria = bc.nome
          AND ep.data_pagamento IS NOT NULL
          AND ep.status = 'pago'
      ), 0)
  ), 0)::NUMERIC
  FROM erp_banco_contas bc
  WHERE bc.company_id = ANY(p_company_ids)
    AND bc.ativo = true
    AND COALESCE(bc.soma_no_saldo, true) = true;
$$;
