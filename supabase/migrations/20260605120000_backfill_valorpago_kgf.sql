-- =============================================================
-- FIX-FINANCEIRO-VALORPAGO-RAIZ-v1 · Backfill valor_pago KGF
-- =============================================================
-- Contexto: lancamentos importados do Omie ficam com valor_pago=0
-- mesmo quando status='pago'. O coalesce do PR #242 mascarava na
-- exibicao; este migration corrige o dado na origem.
--
-- REGRA INVIOLAVEL: aplicar APENAS empresa KGF
-- (a462e13f-0f51-4c54-abe8-4474b591633b). Nao tocar nas 17 empresas
-- BPO clientes.
--
-- Esperado: ~291 linhas erp_receber, ~518 erp_pagar.
-- Resultado real (aplicado via MCP em 2026-06-05):
--   - erp_receber: 291 atualizadas · soma valor_pago = 274815.07
--   - erp_pagar:   518 atualizadas · soma valor_pago = 286775.30
--
-- Fix duradouro do ETL: src/app/api/omie/promote/route.ts ·
-- mapTituloFinanceiro agora seta valor_pago=valor quando
-- status='pago' e valor_pago bruto=0.
-- =============================================================

UPDATE erp_receber
SET valor_pago = valor
WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
  AND status = 'pago'
  AND COALESCE(valor_pago, 0) = 0;

UPDATE erp_pagar
SET valor_pago = valor
WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
  AND status = 'pago'
  AND COALESCE(valor_pago, 0) = 0;
