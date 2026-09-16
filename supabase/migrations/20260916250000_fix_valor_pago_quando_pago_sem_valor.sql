-- FIX (família do #1394): título concluído 'pago' por TER data_pagamento, mas com valor_pago
-- não informado (NULL/0), ficava pago com zero → o caixa/saldo não contava a saída.
-- fn_calcular_status_lancamento retorna 'pago' quando há data_pagamento (ignora valor_pago).
--
-- Correção MÍNIMA e segura: só no ramo ELSE (onde valor_pago já é 0), quando o status concluído
-- é 'pago', preenche valor_pago := líquido (valor+juros+multa−desconto).
-- 🔒 Condição: valor_pago NÃO INFORMADO (NULL ou 0). NUNCA sobrescreve valor_pago já preenchido —
--    pagamento parcial e desconto são legítimos (R$900 de R$1.000 não pode virar R$1.000).
--    (Pagamento parcial cai no ramo 'valor_pago>0' → status 'parcial'; nunca chega no ELSE.)

CREATE OR REPLACE FUNCTION public.fn_trg_status_lancamento()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_liquido numeric; v_saldo numeric;
BEGIN
  IF LOWER(TRIM(COALESCE(NEW.status,''))) IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto') THEN
    RETURN NEW;
  END IF;
  v_liquido := COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) + COALESCE(NEW.multa,0) - COALESCE(NEW.desconto,0);
  v_saldo   := round(v_liquido - COALESCE(NEW.valor_pago,0), 2);
  IF v_saldo <= 0.01 THEN
    NEW.status := 'pago';
    NEW.data_pagamento := COALESCE(NEW.data_pagamento, CURRENT_DATE);
  ELSIF COALESCE(NEW.valor_pago,0) > 0 THEN
    NEW.status := 'parcial';
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
