-- PDCA GE · /dashboard/financeiro/extrato (GAP1 aud8 85/95): a carga direta de 1 mês
-- estourava timeout na DEMO Comércio-GE (...004), que tem ~97k linhas em erp_receber e
-- ~180k em erp_pagar. A RPC fn_ge_extrato_conta filtra por data_pagamento, mas os índices
-- existentes só cobrem (company_id, status) e (company_id, status, data_previsao) — NÃO
-- data_pagamento. Resultado: os ramos acumulados ("saldo antes do período":
-- data_pagamento <= início) e os somatórios/movimentos do período (BETWEEN) varrem TODAS
-- as linhas pagas/recebidas da empresa e descartam no heap pelo filtro de data
-- ("Rows Removed by Filter"), com fetch de heap para cada linha varrida.
--
-- Prova RD-38 (produção, EXPLAIN ANALYZE na DEMO ...004, warm):
--   ramo "antes do período" (erp_receber, data_pagamento <= início): Index Scan em
--   idx_erp_receber_status varrendo 53.894 linhas, 47.031 removidas por filtro de data,
--   ~72 ms; ramo pagar 1 mês varrendo 11.383, 4.634 removidas, ~30 ms. Corpo completo
--   (4 somatórios + movimentos, 11.529 linhas) ~191 ms warm; em cache frio os fetches de
--   heap descartados dominam e estouram o timeout do cliente.
--
-- Correção ADITIVA: índice composto (company_id, status, data_pagamento). Com data_pagamento
-- no índice, o filtro de data vira Index Cond (range scan) e só as linhas realmente dentro
-- do recorte vão ao heap (ex.: 6.863 em vez de 53.894 no ramo acumulado) — queda de ~8x nos
-- fetches de heap, o que elimina o timeout em cache frio. Beneficia também fluxo-caixa,
-- saúde financeira e DRE, que filtram pelo mesmo data_pagamento.
--
-- Sem RLS/ACL (apenas índices); não altera nenhum dado de cliente. Idempotente (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_erp_receber_pagamento
  ON public.erp_receber (company_id, status, data_pagamento);

CREATE INDEX IF NOT EXISTS idx_erp_pagar_pagamento
  ON public.erp_pagar (company_id, status, data_pagamento);
