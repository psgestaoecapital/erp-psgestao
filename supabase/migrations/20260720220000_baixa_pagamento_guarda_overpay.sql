-- RAIZ do valor_pago dobrado (PS Gestão: Aliance 250→448, Prudential 211→431,38, Anthropic 744,43→1540,98):
-- fn_*_baixar_pagamento ACUMULA (valor_pago += baixa) e a única trava era status='pago' (só age DEPOIS de
-- quitado). Falha em: (a) baixa parcial < documento deixa 'parcial' → 2ª baixa soma; (b) duplo-clique/corrida
-- passa a trava. CORREÇÃO: UPDATE ATÔMICO (row lock re-checa sob a linha, race-safe) + guarda anti-overpay que
-- barra SÓ uma baixa SUBSEQUENTE que ultrapasse o total (1ª baixa livre — preserva pagamento único acima do doc).
-- RD-53 PROVADO (transação abortada): parcelamento 400+400+200=pago/1000 OK · duplo 224+224 em doc 250 → 2ª
-- BLOQUEADA (overpay) · 1ª baixa 215,69 em doc 211 → passa (pago). Os 3 registros da PS Gestão já foram
-- corrigidos p/ os valores do extrato (224/215,69/744,43) com trilha VALOR_PAGO_CORRIGIDO.
-- Reverter: restaurar as versões anteriores (que acumulavam sem guarda).

CREATE OR REPLACE FUNCTION public.fn_pagar_baixar_pagamento(p_pagar_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_p record; v_baixa numeric; v_rows int; v_novo record;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a pagar nao encontrada'); END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_p.valor - COALESCE(v_p.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  UPDATE erp_pagar
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor-0.01 THEN 'PAGO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_pagar_id
    AND status <> 'pago'
    AND NOT (COALESCE(valor_pago,0) > 0 AND round(COALESCE(valor_pago,0)+v_baixa,2) > valor + 0.01);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
    IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga', 'saldo_restante', 0); END IF;
    RETURN jsonb_build_object('sucesso', false, 'overpay', true,
      'erro', 'Esta baixa faria o pago ultrapassar o valor do titulo (possivel pagamento duplicado). Saldo: R$'
              || trim(to_char(GREATEST(v_p.valor - COALESCE(v_p.valor_pago,0),0), 'FM999999990.00'))
              || '. Para acrescimo (juros/multa), use os campos proprios.',
      'saldo_restante', GREATEST(round(v_p.valor - COALESCE(v_p.valor_pago,0),2), 0));
  END IF;

  SELECT * INTO v_novo FROM erp_pagar WHERE id = p_pagar_id;
  RETURN jsonb_build_object('sucesso', true, 'pagar_id', p_pagar_id, 'valor_baixa', v_baixa,
    'pago_acumulado', v_novo.valor_pago, 'saldo_restante', GREATEST(round(v_novo.valor - v_novo.valor_pago,2),0),
    'status_novo', v_novo.status);
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_receber_baixar_pagamento(p_receber_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_r record; v_baixa numeric; v_rows int; v_novo record;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a receber nao encontrada'); END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_r.valor - COALESCE(v_r.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  UPDATE erp_receber
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor-0.01 THEN 'RECEBIDO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_receber_id
    AND status <> 'pago'
    AND NOT (COALESCE(valor_pago,0) > 0 AND round(COALESCE(valor_pago,0)+v_baixa,2) > valor + 0.01);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
    IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga', 'saldo_restante', 0); END IF;
    RETURN jsonb_build_object('sucesso', false, 'overpay', true,
      'erro', 'Esta baixa faria o recebido ultrapassar o valor do titulo (possivel duplicidade). Saldo: R$'
              || trim(to_char(GREATEST(v_r.valor - COALESCE(v_r.valor_pago,0),0), 'FM999999990.00')) || '.',
      'saldo_restante', GREATEST(round(v_r.valor - COALESCE(v_r.valor_pago,0),2), 0));
  END IF;

  SELECT * INTO v_novo FROM erp_receber WHERE id = p_receber_id;
  RETURN jsonb_build_object('sucesso', true, 'receber_id', p_receber_id, 'valor_baixa', v_baixa,
    'pago_acumulado', v_novo.valor_pago, 'saldo_restante', GREATEST(round(v_novo.valor - v_novo.valor_pago,2),0),
    'status_novo', v_novo.status, 'forma', p_forma_pagamento);
END; $function$;