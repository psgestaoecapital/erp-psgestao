-- ============================================================
-- FIX (Jordana item 1): "Ajustar valores" quita o título mas deixava o MOVIMENTO pendente.
-- fn_conciliacao_ajustar_valores só dava UPDATE em erp_pagar/erp_receber — não tocava
-- conciliacao_movimento. Depois do ajuste (ex.: juros R$0,18 → título quita R$42,44) o
-- movimento seguia 'pendente', travando o fechamento diário (mesmo RD-52 do #950).
-- Correção: novo p_movimento_id; após o ajuste, concilia pela máquina canônica
-- (fn_conciliacao_aplicar_match → trigger → recompute → baixa) com MOTIVO — o motivo
-- não-vazio ignora o guard de baixa confiança (score<70), então concilia mesmo quando
-- o valor do título e o do banco diferem pelo juros/desconto.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_ajustar_valores(
  p_lancamento_id uuid, p_tipo text,
  p_valor_juros numeric DEFAULT 0, p_valor_desconto numeric DEFAULT 0,
  p_observacao text DEFAULT NULL, p_valor_novo numeric DEFAULT NULL,
  p_movimento_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_valor_atual numeric; v_valor_final numeric; v_company uuid; v_obs text := '';
        v_tabela text; v_match jsonb := NULL;
BEGIN
  IF p_tipo = 'receber' THEN
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_receber WHERE id = p_lancamento_id;
  ELSE
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_pagar WHERE id = p_lancamento_id;
  END IF;
  IF v_valor_atual IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  v_valor_final := COALESCE(p_valor_novo, v_valor_atual);
  IF p_valor_novo IS NOT NULL AND round(p_valor_novo, 2) <> round(v_valor_atual, 2) THEN
    v_obs := v_obs || ' [VALOR AJUSTADO: R$' || to_char(v_valor_atual, 'FM999999990.00')
                   || ' → R$' || to_char(v_valor_final, 'FM999999990.00') || ' na conciliação]';
  END IF;
  IF p_observacao IS NOT NULL AND btrim(p_observacao) <> '' THEN
    v_obs := v_obs || ' [AJUSTE: ' || p_observacao || ']';
  END IF;

  IF p_tipo = 'receber' THEN
    UPDATE erp_receber SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_pagar SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  -- NOVO (item 1): se veio o movimento, concilia de fato pela máquina canônica.
  IF p_movimento_id IS NOT NULL THEN
    v_tabela := CASE WHEN p_tipo = 'receber' THEN 'erp_receber' ELSE 'erp_pagar' END;
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, v_tabela, p_lancamento_id,
             auth.uid(), 'ajuste', 'Conciliado após ajuste de valores') t;
  END IF;

  RETURN jsonb_build_object('sucesso', true,
    'valor_original', v_valor_atual, 'valor_novo', v_valor_final,
    'valor_ajustado', round(v_valor_final + COALESCE(p_valor_juros,0) - COALESCE(p_valor_desconto,0), 2),
    'juros', COALESCE(p_valor_juros,0), 'desconto', COALESCE(p_valor_desconto,0),
    'conciliado', (p_movimento_id IS NOT NULL), 'match', v_match);
END $function$;

-- Remove a assinatura ANTIGA de 6 args (sem p_movimento_id): senão fica ambígua com a
-- nova de 7 args + default (chamada por 6 params casaria as duas → "function is not unique").
DROP FUNCTION IF EXISTS public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text, numeric);
