-- Saneamento Onda 1 · Lote 2d — baixas de pagar/receber (Fase 1 · Limpeza).
-- fn_pagar_baixar_pagamento e fn_receber_baixar_pagamento davam baixa (movimentam DINHEIRO em
-- erp_pagar/erp_receber) resolvendo a linha por id e confiando no chamador — SEM validar empresa.
-- Furo: qualquer sessão (ou anon, pois estavam anon-open) podia baixar título de QUALQUER empresa.
-- Correção: guarda padrão pela empresa da PRÓPRIA linha (v_p.company_id / v_r.company_id).
-- fn_baixar_pagamento_em_massa só encaminha para as duas acima (então herda a proteção por item);
-- ganha ainda uma guarda de sessão no topo + REVOKE anon. Corpo de negócio inalterado.
-- Chamadores internos (remessa/CNAB) seguem funcionando: rodam com o JWT do usuário da empresa
-- (get_user_company_ids devolve a empresa) ou internos/serviço. RDs 25·26·38·52·65.

CREATE OR REPLACE FUNCTION public.fn_pagar_baixar_pagamento(p_pagar_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric, p_origem text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p record; v_baixa numeric; v_rows int; v_novo record; v_origem text;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a pagar nao encontrada'); END IF;
  -- SANEAMENTO 2d: exige que o chamador possa operar a empresa DO TÍTULO.
  IF NOT (coalesce(current_setting('request.jwt.claims', true),'') = '' OR auth.role()='service_role'
          OR v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_p.valor - COALESCE(v_p.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  v_origem := COALESCE(p_origem,
                CASE WHEN lower(COALESCE(p_forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'manual' END);

  UPDATE erp_pagar
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      origem_baixa = COALESCE(origem_baixa, v_origem),
      baixado_por  = COALESCE(baixado_por, auth.uid()),
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

CREATE OR REPLACE FUNCTION public.fn_receber_baixar_pagamento(p_receber_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric, p_origem text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r record; v_baixa numeric; v_rows int; v_novo record; v_origem text;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a receber nao encontrada'); END IF;
  -- SANEAMENTO 2d: exige que o chamador possa operar a empresa DO TÍTULO.
  IF NOT (coalesce(current_setting('request.jwt.claims', true),'') = '' OR auth.role()='service_role'
          OR v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_r.valor - COALESCE(v_r.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  v_origem := COALESCE(p_origem,
                CASE WHEN lower(COALESCE(p_forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'manual' END);

  UPDATE erp_receber
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      origem_baixa = COALESCE(origem_baixa, v_origem),
      baixado_por  = COALESCE(baixado_por, auth.uid()),
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

-- Em massa: só encaminha p/ as duas acima (herda a guarda por item). Aqui, guarda de sessão no topo.
CREATE OR REPLACE FUNCTION public.fn_baixar_pagamento_em_massa(p_tipo text, p_ids uuid[], p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_sucesso int := 0; v_falha int := 0; v_total numeric := 0;
  v_resultado jsonb := '[]'::jsonb; v_item jsonb;
BEGIN
  -- SANEAMENTO 2d: exige sessão (a autorização por empresa é feita em cada baixa por item).
  IF NOT (coalesce(current_setting('request.jwt.claims', true),'') = '' OR auth.role()='service_role' OR auth.uid() IS NOT NULL) THEN
    RAISE EXCEPTION 'Sessão necessária' USING errcode='42501';
  END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    IF p_tipo = 'receber' THEN
      v_item := fn_receber_baixar_pagamento(v_id, p_data_pagamento, p_conta_bancaria_id, p_forma_pagamento);
    ELSE
      v_item := fn_pagar_baixar_pagamento(v_id, p_data_pagamento, p_conta_bancaria_id, p_forma_pagamento);
    END IF;
    v_resultado := v_resultado || v_item;
    IF (v_item ->> 'sucesso')::boolean THEN
      v_sucesso := v_sucesso + 1;
      v_total := v_total + COALESCE((v_item ->> 'valor_pago')::numeric, 0);
    ELSE
      v_falha := v_falha + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'tipo', p_tipo, 'total_processados', array_length(p_ids, 1),
    'sucesso', v_sucesso, 'falha', v_falha, 'valor_total_baixado', v_total, 'detalhes', v_resultado);
END; $function$;

-- REVOKE anon + GRANT authenticated/service_role.
REVOKE EXECUTE ON FUNCTION public.fn_pagar_baixar_pagamento(uuid, date, uuid, text, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_receber_baixar_pagamento(uuid, date, uuid, text, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_baixar_pagamento_em_massa(text, uuid[], date, uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_baixar_pagamento(uuid, date, uuid, text, numeric, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_receber_baixar_pagamento(uuid, date, uuid, text, numeric, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_baixar_pagamento_em_massa(text, uuid[], date, uuid, text) TO authenticated, service_role;
