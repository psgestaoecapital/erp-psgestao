-- ============================================================
-- #38 · Baixa feita sem vínculo — vínculo e baixa passam a ser TUDO OU NADA
-- ============================================================
-- Causa raiz (Jordana): em fn_conciliacao_vincular, o UPDATE que marca o título
-- conciliado=true rodava MESMO SE fn_conciliacao_aplicar_match tivesse falhado
-- (v_match era capturado e nunca verificado). Resultado: título conciliado mas o
-- MOVIMENTO não — estado partido, risco de baixa em duplicidade.
--
-- Correção: o UPDATE só ocorre se o match retornar status_resultado='conciliado'.
-- Se o match falhar (ex.: baixo score pedindo motivo — #37), DESFAZ o vínculo
-- recém-inserido e devolve o erro ao usuário. Vínculo e baixa juntos ou nenhum.
--
-- Diagnóstico no dado (RD-38, antes do fix): 0 títulos com a assinatura EXATA do bug
-- (conciliado + movimento pendente/divergente). Os 4 casos "conciliado + movimento
-- ignorado" são outro padrão (movimento ignorado após conciliar), fora deste fix.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_valor numeric DEFAULT NULL::numeric, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD; v_comp uuid; v_valor numeric; v_saldo numeric;
  v_titulo_valor numeric; v_titulo_pago numeric; v_titulo_jur numeric; v_titulo_dsc numeric; v_liq numeric;
  v_ja_vinc numeric;
  v_soma numeric; v_qtd int; v_fecha boolean; v_match jsonb := NULL;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  v_comp := v_mov.company_id;
  IF p_lancamento_tabela NOT IN ('erp_pagar','erp_receber') THEN
    RETURN jsonb_build_object('ok',false,'erro','tabela invalida'); END IF;

  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT valor, COALESCE(valor_pago,0), COALESCE(juros,0), COALESCE(desconto,0)
      INTO v_titulo_valor, v_titulo_pago, v_titulo_jur, v_titulo_dsc
      FROM erp_pagar WHERE id = p_lancamento_id AND company_id = v_comp;
  ELSE
    SELECT valor, COALESCE(valor_pago,0), COALESCE(juros,0), COALESCE(desconto,0)
      INTO v_titulo_valor, v_titulo_pago, v_titulo_jur, v_titulo_dsc
      FROM erp_receber WHERE id = p_lancamento_id AND company_id = v_comp;
  END IF;
  IF v_titulo_valor IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','lancamento nao encontrado'); END IF;
  v_saldo := round(v_titulo_valor - v_titulo_pago, 2);
  v_liq := round(v_titulo_valor + v_titulo_jur - v_titulo_dsc, 2);

  IF p_valor IS NULL THEN
    -- FIX 1c: título PAGO (saldo<=0) ainda concilia — conciliar CARIMBA, não consome saldo. Base = líquido.
    v_valor := LEAST(round(abs(v_mov.valor),2), GREATEST(CASE WHEN v_saldo > 0.01 THEN v_saldo ELSE v_liq END, 0));
  ELSE
    v_valor := round(p_valor,2);
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','valor deve ser positivo (título sem valor líquido?)'); END IF;

  -- FIX B (RD-52/RD-57): um título nunca recebe vínculos além do seu líquido (mata baixa dobrada / dupla conciliação).
  SELECT COALESCE(sum(valor_vinculado),0) INTO v_ja_vinc
    FROM conciliacao_vinculo
   WHERE lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id
     AND movimento_id <> p_movimento_id;
  IF round(v_ja_vinc + v_valor, 2) > v_liq + 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'titulo_ja_conciliado',
      'msg', 'Este título já foi conciliado (valor já coberto). Não vou duplicar a baixa.',
      'ja_vinculado', v_ja_vinc, 'titulo_liquido', v_liq, 'tentado', v_valor);
  END IF;

  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_comp, p_lancamento_tabela, p_lancamento_id, v_valor, p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE
    SET valor_vinculado = EXCLUDED.valor_vinculado;

  SELECT COALESCE(sum(valor_vinculado),0), count(*) INTO v_soma, v_qtd
    FROM conciliacao_vinculo WHERE movimento_id = p_movimento_id;
  v_fecha := (abs(abs(v_mov.valor) - v_soma) <= 0.05);

  IF v_fecha AND v_qtd = 1 AND v_mov.status IN ('pendente','divergente') THEN
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, p_lancamento_tabela, p_lancamento_id,
             p_operador_id, 'vinculo', 'Conciliado por vínculo manual') t;
    -- FIX #38: só marca o título conciliado se o match REALMENTE conciliou. Vínculo e baixa juntos ou nenhum.
    IF COALESCE(v_match->>'status_resultado','') = 'conciliado' THEN
      IF p_lancamento_tabela = 'erp_pagar' THEN
        UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
      ELSE
        UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
      END IF;
    ELSE
      -- match falhou (ex.: baixo score pedindo motivo — #37): DESFAZ o vínculo e devolve o erro. Nada de baixa órfã.
      DELETE FROM conciliacao_vinculo
       WHERE movimento_id = p_movimento_id AND lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id;
      RETURN jsonb_build_object('ok', false, 'erro', 'match_falhou',
        'msg', COALESCE(v_match->>'mensagem', 'Não foi possível conciliar (match de baixa confiança). Informe o motivo para confirmar.'),
        'status_match', v_match->>'status_resultado');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'valor_vinculado', v_valor, 'valor_movimento', abs(v_mov.valor),
    'soma_vinculada', v_soma, 'saldo_movimento', round(abs(v_mov.valor) - v_soma, 2), 'qtd_vinculos', v_qtd,
    'fecha', v_fecha, 'conciliado_1x1', (v_fecha AND v_qtd = 1),
    'split_pendente_fase2', (v_soma < abs(v_mov.valor) - 0.05), 'match', v_match);
END; $function$;
