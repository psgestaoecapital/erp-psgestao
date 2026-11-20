-- Performance do Extrato Conta Corrente (/dashboard/financeiro/extrato) — GE.
--
-- GAP (aud8 20/11, núcleo financeiro): a tela estourava com "A conexão demorou
-- ou caiu" ao carregar o extrato (período padrão 1 mês, empresa inteira).
-- fn_ge_extrato_conta (SECURITY DEFINER) roda ~6 agregações sobre erp_receber /
-- erp_pagar filtrando por (company_id, status, data_pagamento): saldo anterior,
-- acumulados "antes do início"/"até a âncora", totais do período e a lista de
-- movimentos.
--
-- PROVA RD-38 (prod, DEMO Comércio-GE b0700000-…-004: 97.207 receber + 179.669
-- pagar): não existe índice por data_pagamento. O plano usa idx_erp_pagar_status
-- (company_id, status) e DESCARTA por filtro as linhas fora do período —
-- ex.: "Index Scan … Rows Removed by Filter: 6733" (lê 4.633 úteis + 6.733
-- descartadas = 11.366 linhas; shared buffers=4322). Com cache frio essas leituras
-- repetidas em todas as agregações empurram a consulta para perto do timeout
-- de 15s do papel authenticated.
--
-- CORREÇÃO: índice composto (company_id, status, data_pagamento) nas duas tabelas.
-- O range em data_pagamento passa a ser resolvido pelo próprio índice (sem
-- "Rows Removed by Filter"), cortando as leituras pela metade e estabilizando a
-- carga a frio / de alto volume. Aditiva, idempotente, sem tocar dado de cliente.
-- (A seleção por conta usa conta_bancaria_id/conta_bancaria e é opcional; o filtro
-- dominante e sempre presente é company_id+status+data_pagamento.)

CREATE INDEX IF NOT EXISTS ix_erp_receber_company_status_pagamento
  ON public.erp_receber (company_id, status, data_pagamento);

CREATE INDEX IF NOT EXISTS ix_erp_pagar_company_status_pagamento
  ON public.erp_pagar (company_id, status, data_pagamento);
