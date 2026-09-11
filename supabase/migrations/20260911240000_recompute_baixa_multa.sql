-- ============================================================
-- #39 · fn_recompute_baixa_titulo — alinhar a fórmula do líquido à da trigger (incluir MULTA)
-- ============================================================
-- Defeito latente (RD-44): duas funções decidem o status com fórmulas de líquido DIFERENTES:
--   fn_trg_status_lancamento (trigger, a CERTA): valor + juros + MULTA − desconto
--   fn_recompute_baixa_titulo (conciliação): valor + juros − desconto   ← faltava a MULTA
-- Hoje 0 títulos têm multa, então nunca estourou. No 1º título com multa as duas discordam: a
-- conciliação marcaria 'pago' e a trigger (que dispara na mesma UPDATE, pois status/valor_pago são
-- colunas vigiadas) recalcularia 'parcial' — pingue-pongue. Além do status, o v_liquido é usado no
-- GUARD de excesso (RAISE quando 2+ movimentos somam mais que o líquido); sem multa o guard erra.
-- Fix cirúrgico (RD-60): só a fórmula do líquido. Nada mais do fluxo muda. A trigger permanece a fonte.
-- (O título travado da Julia era outro caminho — baixa manual legada, destravado re-disparando a
--  trigger por coluna vigiada; a trigger só dispara em UPDATE OF das colunas de valor/status.)

CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_valor numeric; v_venc date; v_soma numeric; v_n int; v_dt date; v_status text;
        v_juros numeric; v_multa numeric; v_desc numeric; v_liquido numeric;
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  SELECT COALESCE(SUM(valor),0), count(*), max(data_transacao) INTO v_soma, v_n, v_dt
    FROM public.conciliacao_movimento
   WHERE lancamento_tabela = p_tabela AND lancamento_id = p_id AND status = 'conciliado';
  IF p_tabela = 'erp_receber' THEN
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(multa,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_multa, v_desc FROM public.erp_receber WHERE id = p_id;
  ELSE
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(multa,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_multa, v_desc FROM public.erp_pagar WHERE id = p_id;
  END IF;
  IF v_valor IS NULL THEN RETURN; END IF;
  -- MESMA fórmula da trigger fn_trg_status_lancamento (fonte única do saldo · RD-52)
  v_liquido := round(v_valor + v_juros + v_multa - v_desc, 2);
  IF v_n >= 2 AND v_soma > v_liquido + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liquido,'FM999999990.00') USING ERRCODE = '23514';
  END IF;
  v_status := CASE WHEN v_soma <= 0 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
    WHEN v_soma + 0.01 >= v_liquido THEN 'pago' ELSE 'parcial' END;
  IF p_tabela = 'erp_receber' THEN
    UPDATE public.erp_receber SET valor_pago = v_soma, status = v_status,
      data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
      forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
      updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE public.erp_pagar SET valor_pago = v_soma, status = v_status,
      data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
      forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
      updated_at = now() WHERE id = p_id;
  END IF;
END $function$;
