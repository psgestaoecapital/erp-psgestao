-- FIX FINANCEIRO · baixa parcial ACUMULA (não sobrescreve) · receber + pagar · RD-53/54
-- ============================================================================
-- Bug (KGF, Kleiton): fn_receber_baixar_pagamento e fn_pagar_baixar_pagamento faziam
--   valor_pago := COALESCE(p_valor_pago, valor)         -- SOBRESCREVE (perde a baixa anterior)
--   status = CASE WHEN p_valor_pago >= valor_TOTAL ...  -- compara vs TOTAL, não vs SALDO
-- → 2ª baixa (R$33,33 de um saldo de 33,33 sobre 133,33) apagava a 1ª (R$100) e ficava
--   'parcial' pra sempre. Saldo fantasma que nunca zera.
--
-- Fix (a lógica CERTA já existia em fn_*_registrar_*): as baixar_pagamento passam a
--   ACUMULAR (valor_pago += valor desta baixa), comparar com TOLERÂNCIA de centavo
--   (>= valor - 0,01) e gravar RASTRO VISÍVEL em observações. p_valor_pago NULL = quita o
--   SALDO restante (não o total) — protege o caminho do boleto (fn_boleto_liquidar passa o
--   valor cheio sobre valor_pago=0, e só chama 1x por causa da guarda boleto_status='liquidado').
-- Assinaturas preservadas → conserta TODOS os chamadores (modal + boleto/sync) de uma vez.
-- Sem migração de DADO: as parciais atuais da KGF já estão certas; o bug só dispara na próxima baixa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_receber_baixar_pagamento(p_receber_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_r record; v_baixa numeric; v_pago_acum numeric; v_status text;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a receber nao encontrada'); END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;

  -- valor DESTA baixa: se null, quita o SALDO restante (não o total)
  v_baixa := round(COALESCE(p_valor_pago, v_r.valor - COALESCE(v_r.valor_pago, 0)), 2);
  v_pago_acum := round(COALESCE(v_r.valor_pago, 0) + v_baixa, 2);       -- ACUMULA
  v_status := CASE WHEN v_pago_acum >= v_r.valor - 0.01 THEN 'pago' ELSE 'parcial' END;  -- tolerância de centavo

  UPDATE erp_receber
  SET status = v_status,
      valor_pago = v_pago_acum,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN v_status='pago' THEN 'RECEBIDO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_receber_id;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', p_receber_id,
    'valor_baixa', v_baixa, 'pago_acumulado', v_pago_acum,
    'saldo_restante', GREATEST(round(v_r.valor - v_pago_acum, 2), 0),
    'status_novo', v_status, 'forma', p_forma_pagamento);
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_pagar_baixar_pagamento(p_pagar_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_p record; v_baixa numeric; v_pago_acum numeric; v_status text;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a pagar nao encontrada'); END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;

  v_baixa := round(COALESCE(p_valor_pago, v_p.valor - COALESCE(v_p.valor_pago, 0)), 2);
  v_pago_acum := round(COALESCE(v_p.valor_pago, 0) + v_baixa, 2);
  v_status := CASE WHEN v_pago_acum >= v_p.valor - 0.01 THEN 'pago' ELSE 'parcial' END;

  UPDATE erp_pagar
  SET status = v_status,
      valor_pago = v_pago_acum,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN v_status='pago' THEN 'PAGO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_pagar_id;

  RETURN jsonb_build_object('sucesso', true, 'pagar_id', p_pagar_id,
    'valor_baixa', v_baixa, 'pago_acumulado', v_pago_acum,
    'saldo_restante', GREATEST(round(v_p.valor - v_pago_acum, 2), 0),
    'status_novo', v_status);
END; $function$;
