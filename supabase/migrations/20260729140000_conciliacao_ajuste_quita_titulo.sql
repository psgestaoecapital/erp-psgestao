-- CONCILIAÇÃO · ajuste de diferença quita o título (fecha o gap do SPEC "ajuste no match, estilo Fly").
--
-- Diagnóstico (auditado, corrige a premissa do SPEC):
--   • A TELA de ajuste JÁ EXISTE e JÁ está fiada: quando |valor_banco − valor_título| > 0,01 o "Conciliar"
--     abre o AjustarValoresModal (juros/desconto OU "deixar em aberto"/parcial). Nada de UI a construir.
--   • "Deixar em aberto" JÁ funciona: fn_*_registrar_pagamento deixa o título 'parcial' com saldo.
--   • BUG real (invertido do que o SPEC supôs): JUROS/DESCONTO não quitava o título. fn_conciliacao_ajustar_valores
--     gravava só valor_pago; mas quem manda no status é fn_recompute_baixa_titulo (via trigger trg_baixa_por_conciliacao
--     no aplicar_match), e ele comparava a SOMA dos movimentos conciliados contra o `valor` BRUTO. Com desconto,
--     o movimento (ex.: 1.040) < valor (1.099) → título ficava 'parcial' com R$59 "em aberto", apesar de o modal
--     prometer "título quita".
--
-- Correção (aditiva, fonte única = RD-52):
--   1) fn_conciliacao_ajustar_valores passa a persistir juros/desconto NAS COLUNAS do título (já existem).
--   2) fn_recompute_baixa_titulo passa a comparar a soma dos movimentos contra o LÍQUIDO = valor + juros − desconto.
--   Como juros/desconto default 0, o líquido = valor para todo título sem ajuste → ZERO regressão no caminho normal.
--   Só muda o título que passou pelo ajuste: desconto/juros agora QUITA (soma ≥ líquido → 'pago').

-- 1) o ajuste grava juros/desconto no título (além de valor_pago/obs, que o recompute depois recalcula)
CREATE OR REPLACE FUNCTION public.fn_conciliacao_ajustar_valores(
  p_lancamento_id uuid, p_tipo text, p_valor_juros numeric DEFAULT 0,
  p_valor_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_valor_original numeric; v_valor_ajustado numeric;
BEGIN
  IF p_tipo = 'receber' THEN
    SELECT valor INTO v_valor_original FROM erp_receber WHERE id = p_lancamento_id;
    v_valor_ajustado := v_valor_original + COALESCE(p_valor_juros,0) - COALESCE(p_valor_desconto,0);
    UPDATE erp_receber
      SET juros = COALESCE(p_valor_juros,0),
          desconto = COALESCE(p_valor_desconto,0),
          valor_pago = v_valor_ajustado,
          observacoes = COALESCE(observacoes, '') || COALESCE(' [AJUSTE: ' || p_observacao || ']', ''),
          updated_at = NOW()
    WHERE id = p_lancamento_id;
  ELSE
    SELECT valor INTO v_valor_original FROM erp_pagar WHERE id = p_lancamento_id;
    v_valor_ajustado := v_valor_original + COALESCE(p_valor_juros,0) - COALESCE(p_valor_desconto,0);
    UPDATE erp_pagar
      SET juros = COALESCE(p_valor_juros,0),
          desconto = COALESCE(p_valor_desconto,0),
          valor_pago = v_valor_ajustado,
          observacoes = COALESCE(observacoes, '') || COALESCE(' [AJUSTE: ' || p_observacao || ']', ''),
          updated_at = NOW()
    WHERE id = p_lancamento_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'valor_original', v_valor_original,
    'valor_ajustado', v_valor_ajustado, 'juros', COALESCE(p_valor_juros,0), 'desconto', COALESCE(p_valor_desconto,0));
END; $function$;

-- 2) o recompute compara a soma dos movimentos conciliados contra o LÍQUIDO (valor + juros − desconto)
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_valor numeric; v_venc date; v_soma numeric; v_n int; v_dt date; v_status text;
        v_juros numeric; v_desc numeric; v_liquido numeric;
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  SELECT COALESCE(SUM(valor),0), count(*), max(data_transacao) INTO v_soma, v_n, v_dt
    FROM public.conciliacao_movimento
   WHERE lancamento_tabela = p_tabela AND lancamento_id = p_id AND status = 'conciliado';
  IF p_tabela = 'erp_receber' THEN
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_desc FROM public.erp_receber WHERE id = p_id;
  ELSE
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_desc FROM public.erp_pagar WHERE id = p_id;
  END IF;
  IF v_valor IS NULL THEN RETURN; END IF;
  -- líquido a liquidar: desconto abaixa, juros sobe. É contra ele que a soma dos movimentos fecha (quita).
  v_liquido := round(v_valor + v_juros - v_desc, 2);
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

-- 3) camada final do status (trigger BEFORE UPDATE OF status): também neta juros/desconto.
--   Sem isto, este trigger reescrevia 'pago' -> 'parcial' comparando valor_pago contra o `valor` BRUTO,
--   desfazendo o recompute justamente no caso do desconto. Blast radius = 0 (nenhum título tinha ajuste).
CREATE OR REPLACE FUNCTION public.fn_trg_status_lancamento()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_liquido numeric;
BEGIN
  -- líquido a liquidar (fonte única com fn_recompute_baixa_titulo): desconto abaixa, juros sobe.
  v_liquido := COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) - COALESCE(NEW.desconto,0);
  -- Pagamento parcial: pagou/recebeu parte, mas nao o liquido -> mantem 'parcial'
  IF LOWER(TRIM(COALESCE(NEW.status,''))) NOT IN ('cancelado','cancelled','canceled','estornado')
     AND COALESCE(NEW.valor_pago,0) > 0
     AND COALESCE(NEW.valor_pago,0) < v_liquido - 0.01 THEN
    NEW.status := 'parcial';
  ELSE
    NEW.status := fn_calcular_status_lancamento(
      NEW.data_vencimento,
      NEW.data_pagamento,
      NEW.status
    );
  END IF;
  RETURN NEW;
END;
$function$;
