-- NÚCLEO FINANCEIRO · #10136 CAMADA 1 (trava no banco) · fecha o gap do gatilho de status.
-- CAUSA-RAIZ (RD-38, provada na def VIVA): a regra "parcial só com valor_pago < valor original;
-- valor_pago >= valor ⇒ pago; juros/multa nunca forçam parcial" JÁ vive em fn_trg_status_lancamento
-- (migration 20261121130120), como gatilho BEFORE INSERT OR UPDATE OF em erp_receber e erp_pagar.
-- MAS o gatilho dispara só para as colunas: data_vencimento, data_pagamento, status, valor_pago,
-- desconto, multa, juros — **`valor` NÃO está na lista**. Logo, BAIXAR o `valor` de um título
-- (ex.: "Ajustar valores" corrige a conta recorrente p/ um valor menor) pode deixar
-- valor_pago >= valor SEM re-derivar o status → fica "parcial" impossível, o mesmo estado que o bug
-- do agrupado gerou. `valor` é entrada DIRETA da derivação (v_original = valor − desconto), então
-- precisa disparar o gatilho.
--
-- FIX: recria os dois gatilhos adicionando `valor` à lista de colunas (mesma função, mesma regra).
-- Aditivo e seguro: NÃO altera dado nenhum; só amplia QUANDO o gatilho re-deriva o status. Linhas
-- existentes só são reavaliadas no próximo write que toque uma coluna da derivação (o saneamento das
-- linhas legadas vai na migration 20261126013035). Nenhum título válido muda de estado por este DDL.

-- erp_receber
DROP TRIGGER IF EXISTS trg_status_receber ON public.erp_receber;
CREATE TRIGGER trg_status_receber
  BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status, valor_pago, valor, desconto, multa, juros
  ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION fn_trg_status_lancamento();

-- erp_pagar
DROP TRIGGER IF EXISTS trg_status_pagar ON public.erp_pagar;
CREATE TRIGGER trg_status_pagar
  BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status, valor_pago, valor, desconto, multa, juros
  ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION fn_trg_status_lancamento();

-- Agora a derivação do status dispara em TODA mudança de entrada (valor, valor_pago, juros, multa,
-- desconto, datas, status). Combinado com 20261121130120 (a regra) e 20261126013035 (saneamento das
-- 2 linhas legadas), o estado "parcial com valor_pago >= valor original" fica IMPOSSÍVEL por qualquer
-- caminho: baixa manual, conciliação simples, agrupada, import, API.
