-- =================================================================
-- BAIXA PARCIAL ACUMULATIVA · erp_receber e erp_pagar
-- RPCs novas (NAO substituem fn_*_baixar_pagamento existentes).
-- =================================================================

CREATE OR REPLACE FUNCTION public.fn_receber_registrar_recebimento(
  p_receber_id uuid, p_data_pagamento date, p_valor_recebido numeric,
  p_forma_pagamento text DEFAULT 'PIX', p_conta_bancaria_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_r record; v_pago_acum numeric; v_saldo numeric; v_status text;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta a receber nao encontrada'); END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta ja esta paga'); END IF;
  IF v_r.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('sucesso',false,'erro','Sem permissao'); END IF;
  IF p_valor_recebido IS NULL OR p_valor_recebido <= 0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Valor recebido invalido'); END IF;

  v_pago_acum := round(COALESCE(v_r.valor_pago,0) + p_valor_recebido, 2);
  v_saldo     := round(v_r.valor - v_pago_acum, 2);
  v_status    := CASE WHEN v_pago_acum >= v_r.valor - 0.01 THEN 'pago' ELSE 'parcial' END;

  UPDATE erp_receber
  SET valor_pago = v_pago_acum,
      status = v_status,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes,'') || COALESCE(' [PARCIAL '||to_char(p_data_pagamento,'DD/MM')||': R$'||p_valor_recebido||COALESCE(' - '||p_observacao,'')||']',''),
      updated_at = NOW()
  WHERE id = p_receber_id;

  RETURN jsonb_build_object('sucesso',true,'valor_recebido',p_valor_recebido,
    'pago_acumulado',v_pago_acum,'saldo_restante',GREATEST(v_saldo,0),'status',v_status);
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_receber_registrar_recebimento(uuid,date,numeric,text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_pagar_registrar_pagamento(
  p_pagar_id uuid, p_data_pagamento date, p_valor_pago numeric,
  p_forma_pagamento text DEFAULT 'PIX', p_conta_bancaria_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_p record; v_pago_acum numeric; v_saldo numeric; v_status text;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta a pagar nao encontrada'); END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta ja esta paga'); END IF;
  IF v_p.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('sucesso',false,'erro','Sem permissao'); END IF;
  IF p_valor_pago IS NULL OR p_valor_pago <= 0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Valor invalido'); END IF;

  v_pago_acum := round(COALESCE(v_p.valor_pago,0) + p_valor_pago, 2);
  v_saldo     := round(v_p.valor - v_pago_acum, 2);
  v_status    := CASE WHEN v_pago_acum >= v_p.valor - 0.01 THEN 'pago' ELSE 'parcial' END;

  UPDATE erp_pagar
  SET valor_pago = v_pago_acum,
      status = v_status,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes,'') || COALESCE(' [PARCIAL '||to_char(p_data_pagamento,'DD/MM')||': R$'||p_valor_pago||COALESCE(' - '||p_observacao,'')||']',''),
      updated_at = NOW()
  WHERE id = p_pagar_id;

  RETURN jsonb_build_object('sucesso',true,'valor_pago',p_valor_pago,
    'pago_acumulado',v_pago_acum,'saldo_restante',GREATEST(v_saldo,0),'status',v_status);
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_pagar_registrar_pagamento(uuid,date,numeric,text,uuid,text) TO authenticated;
