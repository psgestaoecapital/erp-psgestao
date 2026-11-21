-- Chamado #10136 (Jordana · casos reais Pdois, Proplay, Kgf) — fatia 1 (regra de status):
-- "Parcial só quando pago/recebido MENOS de 100% do valor do título ORIGINAL. Valor igual ou maior que o
--  original, mesmo sem informar juros, liquida por inteiro. Juros e multa calculados pelo atraso nunca podem
--  fazer o título ficar parcial se o valor original foi pago (juros/multa são receita financeira no DRE)."
--
-- Diagnóstico (RD-38, provado no dado antes de corrigir):
--   fn_trg_status_lancamento (trigger compartilhado por erp_receber=trg_status_receber e erp_pagar=trg_status_pagar)
--   decide o status comparando valor_pago com v_liquido = valor + juros + multa - desconto. Quando havia juros/multa
--   de atraso e o cliente pagou só o valor ORIGINAL, v_saldo > 0 e valor_pago > 0 ⇒ status 'parcial' (defeito).
--   Rows provadas (erp_receber):
--     - IGP CEREAIS 2026-08 (111e845e): valor 138,00 · pago 138,00 · juros 5,52 ⇒ estava 'parcial' (deveria liquidar).
--     - MBOX IMPORTS 2026-08 (684158fe): valor 2.500,00 · pago 2.500,01 · juros 2.289,55 ⇒ estava 'parcial'.
--   (Títulos já gravados como parcial com pagamento ≥ original — ex. OS-2026-0305 Kgf, saldo 0 porém 'parcial' por
--    gravação antiga sem re-disparo do trigger — são corrigidos na fatia de BACKFILL, separada, com OK da Jordana e
--    lista antes/depois; esta migration NÃO altera dado existente, só a regra para baixas futuras.)
--
-- Correção (aditiva, mínima — reproduz a função viva idêntica e troca só o ramo de classificação):
--   O título liquida ('pago') quando o pagamento cobre o VALOR ORIGINAL líquido de desconto (valor - desconto),
--   mesmo que juros/multa acrescidos pelo atraso não tenham sido cobertos. 'parcial' só quando pagou MENOS que isso.
--   O ramo "saldo <= 0,01" (cobriu tudo, inclusive juros) continua liquidando como antes — sem regressão.

CREATE OR REPLACE FUNCTION public.fn_trg_status_lancamento()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_liquido numeric; v_saldo numeric; v_original numeric;
BEGIN
  IF LOWER(TRIM(COALESCE(NEW.status,''))) IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto') THEN
    RETURN NEW;
  END IF;
  v_liquido := COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) + COALESCE(NEW.multa,0) - COALESCE(NEW.desconto,0);
  v_saldo   := round(v_liquido - COALESCE(NEW.valor_pago,0), 2);
  -- #10136: valor original líquido de desconto (SEM juros/multa de atraso) — é o limiar da liquidação.
  v_original := round(COALESCE(NEW.valor,0) - COALESCE(NEW.desconto,0), 2);
  IF v_saldo <= 0.01 THEN
    NEW.status := 'pago';
    NEW.data_pagamento := COALESCE(NEW.data_pagamento, CURRENT_DATE);
  ELSIF COALESCE(NEW.valor_pago,0) > 0 THEN
    -- #10136: pagou o valor original (ou mais) ⇒ liquida por inteiro; juros/multa de atraso não forçam parcial.
    IF round(COALESCE(NEW.valor_pago,0), 2) >= v_original THEN
      NEW.status := 'pago';
      NEW.data_pagamento := COALESCE(NEW.data_pagamento, CURRENT_DATE);
    ELSE
      NEW.status := 'parcial';
    END IF;
  ELSIF NEW.status IN ('incluido_remessa','agendado') THEN
    RETURN NEW;
  ELSE
    NEW.status := fn_calcular_status_lancamento(NEW.data_vencimento, NEW.data_pagamento, NEW.status); -- aberto/vencido/pago
    -- FIX: concluiu 'pago' por ter data_pagamento, mas valor_pago não foi informado → preenche com o líquido.
    -- (aqui valor_pago é sempre 0/NULL; parcial nunca chega neste ramo, então não há risco de sobrescrever)
    IF NEW.status = 'pago' AND COALESCE(NEW.valor_pago,0) = 0 THEN
      NEW.valor_pago := v_liquido;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
