-- ============================================================
-- trg_status_receber — alinhar as colunas vigiadas às de trg_status_pagar
-- ============================================================
-- Assimetria encontrada (RD-44) entre as duas triggers de status, ambas em fn_trg_status_lancamento:
--   trg_status_pagar   BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status,
--                                                 valor_pago, desconto, multa, juros
--   trg_status_receber BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status
--                                                 ↑ NÃO vigia valor_pago, desconto, multa nem juros
--
-- Consequência: um recebimento cujo valor_pago (ou juros/multa/desconto) é atualizado por um caminho
-- que NÃO toca a coluna status não tem o status recalculado — fica travado em 'aberto'/'parcial' mesmo
-- já quitado. É o mesmo defeito do título da Julia (erp_pagar), mas no dinheiro que ENTRA: além de
-- travar a baixa, um título quitado preso em 'parcial'/'vencido' vira cobrança indevida de cliente.
-- Ainda não estourou porque as RPCs de recebimento gravam o status junto com o valor_pago; basta um
-- caminho novo que atualize só o valor_pago para reproduzir.
--
-- Fix cirúrgico (RD-60): só a lista de colunas vigiadas do trg_status_receber, igualando ao pagar.
-- A função (fonte única do saldo) não muda. Estados terminais (cancelado/renegociado/estornado/previsto)
-- seguem preservados — a função os retorna sem recomputar.
--
-- Provado (RD-59, em transação com ROLLBACK, sem tocar produção):
--   TESTE A (trigger atual, UPDATE só no valor_pago): status = 'aberto'  ← o bug
--   TESTE B (trigger nova,  UPDATE só no valor_pago): status = 'pago'    ← recalcula sozinho
-- RD-61: DROP/CREATE de trigger é DDL — não altera nenhuma linha existente; contagem por status em
--   erp_receber idêntica antes e depois (aberto 1527 · cancelado 99 · pago 2126 · parcial 6 · vencido 215).

DROP TRIGGER IF EXISTS trg_status_receber ON public.erp_receber;
CREATE TRIGGER trg_status_receber
  BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status, valor_pago, desconto, multa, juros
  ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION fn_trg_status_lancamento();
