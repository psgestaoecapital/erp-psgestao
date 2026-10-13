-- ============================================================
-- FIX Conciliação 1:1 (baixa canônica real) + histórico da conta
-- RD-41/26/52 · Fase A (1:1). Reportado por Jordana (SALÁRIO KLEITON 1/12).
-- ------------------------------------------------------------
-- Raiz: o botão "Conciliar" grava só em conciliacao_vinculo e nunca seta
-- movimento.lancamento_id/status='conciliado' -> o gatilho fn_baixa_por_conciliacao
-- nunca dispara -> sem baixa e movimento fica pendente; além disso o default de
-- p_valor usava o valor TOTAL do título (não o do movimento).
-- Correção A: no fechamento 1:1 reaproveita a máquina canônica
-- (fn_conciliacao_aplicar_match -> trigger -> fn_recompute_baixa_titulo) e corrige
-- o valor default. Split N:1 continua Fase 2. Aditivo (CREATE OR REPLACE de RPCs).
-- ============================================================

-- A.1 — fn_conciliacao_vincular: valor default correto + baixa canônica no 1:1
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(
  p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid,
  p_valor numeric DEFAULT NULL, p_operador_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD; v_comp uuid; v_valor numeric; v_saldo numeric;
  v_titulo_valor numeric; v_titulo_pago numeric;
  v_soma numeric; v_qtd int; v_fecha boolean; v_match jsonb := NULL;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  v_comp := v_mov.company_id;

  IF p_lancamento_tabela NOT IN ('erp_pagar','erp_receber') THEN
    RETURN jsonb_build_object('ok',false,'erro','tabela invalida'); END IF;

  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT valor, COALESCE(valor_pago,0) INTO v_titulo_valor, v_titulo_pago
      FROM erp_pagar WHERE id = p_lancamento_id AND company_id = v_comp;
  ELSE
    SELECT valor, COALESCE(valor_pago,0) INTO v_titulo_valor, v_titulo_pago
      FROM erp_receber WHERE id = p_lancamento_id AND company_id = v_comp;
  END IF;
  IF v_titulo_valor IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','lancamento nao encontrado'); END IF;
  v_saldo := round(v_titulo_valor - v_titulo_pago, 2);

  -- FIX: default = valor do MOVIMENTO limitado ao saldo do título (não o total do título)
  IF p_valor IS NULL THEN
    v_valor := LEAST(round(abs(v_mov.valor),2), GREATEST(v_saldo,0));
  ELSE
    v_valor := round(p_valor,2);
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','valor deve ser positivo (saldo do título esgotado?)'); END IF;

  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_comp, p_lancamento_tabela, p_lancamento_id, v_valor, p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE
    SET valor_vinculado = EXCLUDED.valor_vinculado;

  SELECT COALESCE(sum(valor_vinculado),0), count(*) INTO v_soma, v_qtd
    FROM conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  v_fecha := (abs(abs(v_mov.valor) - v_soma) <= 0.05);

  -- CANÔNICO 1:1 — movimento totalmente alocado num ÚNICO título:
  -- reaproveita fn_conciliacao_aplicar_match -> seta movimento.lancamento_id+status=conciliado
  -- -> dispara fn_baixa_por_conciliacao -> baixa correta (valor do movimento, forma=conciliacao_bancaria).
  IF v_fecha AND v_qtd = 1 AND v_mov.status IN ('pendente','divergente') THEN
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, p_lancamento_tabela, p_lancamento_id,
             p_operador_id, 'vinculo', 'Conciliado por vínculo manual') t;

    IF p_lancamento_tabela = 'erp_pagar' THEN
      UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        WHERE id = p_lancamento_id;
    ELSE
      -- erp_receber possui as colunas conciliado/movimento_banco_id (confirmado no schema).
      UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        WHERE id = p_lancamento_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_vinculado', v_valor,
    'valor_movimento', abs(v_mov.valor),
    'soma_vinculada', v_soma,
    'saldo_movimento', round(abs(v_mov.valor) - v_soma, 2),
    'qtd_vinculos', v_qtd,
    'fecha', v_fecha,
    'conciliado_1x1', (v_fecha AND v_qtd = 1),
    'split_pendente_fase2', (v_soma < abs(v_mov.valor) - 0.05),
    'match', v_match
  );
END; $function$;


-- A.2 — fn_pagar_historico: eventos da conta com data/forma/origem (queixa #2)
CREATE OR REPLACE FUNCTION public.fn_pagar_historico(p_pagar_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p RECORD; v_eventos jsonb;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','conta nao encontrada'); END IF;
  IF v_p.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'origem','conciliacao',
           'data', cm.data_transacao,
           'valor', abs(cm.valor),
           'forma','conciliacao_bancaria',
           'descricao_banco', cm.descricao,
           'movimento_id', cm.id,
           'aplicado_em', cm.match_aplicado_em)
         ORDER BY cm.data_transacao)
    INTO v_eventos
    FROM conciliacao_movimento cm
   WHERE cm.lancamento_tabela='erp_pagar' AND cm.lancamento_id = p_pagar_id AND cm.status='conciliado';

  RETURN jsonb_build_object(
    'ok', true,
    'conta', jsonb_build_object(
       'id', v_p.id, 'descricao', v_p.descricao, 'valor', v_p.valor,
       'valor_pago', COALESCE(v_p.valor_pago,0), 'saldo', round(v_p.valor - COALESCE(v_p.valor_pago,0),2),
       'status', v_p.status, 'data_pagamento', v_p.data_pagamento,
       'forma_pagamento', v_p.forma_pagamento, 'conciliado', COALESCE(v_p.conciliado,false)),
    'eventos_conciliacao', COALESCE(v_eventos, '[]'::jsonb),
    'observacoes', v_p.observacoes
  );
END; $function$;
