-- fix(financeiro/boleto): boleto pago com juros baixa COM juros e fica pago — também na conciliação (simples e agrupada).
-- Caso real (P&M piloto, banco 748, parcela 4/11 R$138, cliente pagou R$143,52 = 138 + 5,52 de juros): a baixa do boleto
-- ignorou os juros e a conciliação lançou os 5,52 no título sem somar ao valor_pago → ficou "parcial" (inadimplente).
--
-- REGRA ÚNICA (boleto, conciliação simples e agrupada): valor_pago = valor efetivamente recebido = valor − desconto +
-- juros + multa. A soma de erp_receber_baixa do título = valor_pago. Assim o trigger de status fecha 'pago' e o caixa
-- bate com o extrato. (É como os outros 3 boletos pagos com juros já estão gravados.) RD-100: na tela, "banco".

-- ───────── 0) coluna de reversão do ajuste da conciliação (aditiva) — guarda o estado ANTES do ajuste no vínculo ─────────
ALTER TABLE public.conciliacao_vinculo
  ADD COLUMN IF NOT EXISTS ajuste_juros_antes      numeric,
  ADD COLUMN IF NOT EXISTS ajuste_desconto_antes   numeric,
  ADD COLUMN IF NOT EXISTS ajuste_valor_pago_antes numeric;
COMMENT ON COLUMN public.conciliacao_vinculo.ajuste_valor_pago_antes IS
  'Estado do título ANTES do ajuste desta conciliação, p/ desfazer (fn_conciliacao_desvincular_movimento restaura).';

-- ───────── 1) fn_boleto_liquidar: aplica a REGRA ÚNICA (diferença do banco → juros; valor_pago = valor pago pelo banco) ─────────
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(p_company_id uuid, p_nosso_numero text, p_data_pagamento date, p_valor_pago numeric DEFAULT NULL::numeric, p_provider_raw jsonb DEFAULT '{}'::jsonb, p_provider text DEFAULT NULL::text, p_banco_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_receber record; v_conta_id uuid; v_baixa jsonb; v_dif numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_banco_codigo,'')),'') IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'banco_obrigatorio', 'nosso_numero', p_nosso_numero);
  END IF;

  SELECT id, status, valor, boleto_status INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id AND boleto_banco_codigo = p_banco_codigo AND boleto_nosso_numero = p_nosso_numero
    AND deleted_at IS NULL
  ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado', 'nosso_numero', p_nosso_numero, 'banco_codigo', p_banco_codigo);
  END IF;
  IF v_receber.boleto_status = 'liquidado' OR v_receber.status IN ('pago','recebido') THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true, 'receber_id', v_receber.id);
  END IF;

  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ativo = true
  ORDER BY (ambiente = 'producao') DESC, updated_at DESC NULLS LAST LIMIT 1;

  -- Baixa pelo valor pago pelo banco (quando informado). Sem o valor do banco, baixa pelo valor do título e sinaliza
  -- para conferir juros na conciliação — NUNCA finge que não teve juros em silêncio.
  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id := v_receber.id, p_data_pagamento := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id, p_forma_pagamento := 'BOLETO',
    p_valor_pago := COALESCE(p_valor_pago, v_receber.valor), p_origem := 'boleto');

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa', 'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  -- REGRA ÚNICA: a diferença entre o valor pago pelo banco e o valor do título é juros/encargos (ou aviso se a menor).
  IF p_valor_pago IS NOT NULL THEN
    v_dif := round(p_valor_pago - v_receber.valor, 2);
    IF v_dif > 0.01 THEN
      UPDATE erp_receber SET juros = v_dif,
        observacoes = COALESCE(observacoes,'') || ' [juros/encargos pagos no boleto: R$' || trim(to_char(v_dif,'FM999999990.00')) || ']'
       WHERE id = v_receber.id;
    ELSIF v_dif < -0.01 THEN
      UPDATE erp_receber SET
        observacoes = COALESCE(observacoes,'') || ' [boleto pago a menor no banco: R$' || trim(to_char(-v_dif,'FM999999990.00')) || ' — conferir desconto ou pagamento parcial]'
       WHERE id = v_receber.id;
    END IF;
  ELSE
    v_dif := NULL;
    UPDATE erp_receber SET
      observacoes = COALESCE(observacoes,'') || ' [valor pago não informado pelo banco — conferir juros na conciliação]'
     WHERE id = v_receber.id;
  END IF;

  UPDATE erp_receber SET boleto_status = 'liquidado', boleto_pago_em = NOW() WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES (p_company_id, p_banco_codigo, p_provider, 'boleto_liquidar', 'ok', 1,
        format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento), p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id, 'nosso_numero', p_nosso_numero,
    'banco_codigo', p_banco_codigo, 'conta_bancaria_id', v_conta_id, 'baixa', v_baixa,
    'diferenca', v_dif,
    'tipo_diferenca', CASE WHEN v_dif IS NULL THEN 'valor_nao_informado' WHEN v_dif > 0.01 THEN 'juros' WHEN v_dif < -0.01 THEN 'pago_a_menor' ELSE 'nenhuma' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) TO authenticated, service_role;

-- ───────── 1b) fn_boleto_liquidar_banco: agora é só um invólucro (uma função só trata juros p/ todos os bancos) ─────────
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar_banco(p_company_id uuid, p_banco_codigo text, p_nosso_numero text, p_data_pagamento date, p_valor_pago numeric, p_provider_raw jsonb DEFAULT '{}'::jsonb, p_provider text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF p_valor_pago IS NULL OR p_valor_pago <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'valor_pago_obrigatorio', 'nosso_numero', p_nosso_numero);
  END IF;
  RETURN public.fn_boleto_liquidar(p_company_id, p_nosso_numero, p_data_pagamento, p_valor_pago, p_provider_raw, p_provider, p_banco_codigo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidar_banco(uuid, text, text, date, numeric, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar_banco(uuid, text, text, date, numeric, jsonb, text) TO authenticated, service_role;

-- ───────── 2) fn_conciliacao_ajustar_valores: ao lançar acréscimo, soma TAMBÉM em valor_pago (= valor recebido) ─────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_ajustar_valores(p_lancamento_id uuid, p_tipo text, p_valor_juros numeric DEFAULT 0, p_valor_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text, p_valor_novo numeric DEFAULT NULL::numeric, p_movimento_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_valor_atual numeric; v_valor_final numeric; v_company uuid; v_obs text := '';
        v_tabela text; v_match jsonb := NULL; v_match_status text;
        v_multa numeric; v_juros_antes numeric; v_desc_antes numeric; v_pago_antes numeric; v_net numeric;
BEGIN
  IF p_tipo = 'receber' THEN
    SELECT valor, company_id, COALESCE(multa,0), COALESCE(juros,0), COALESCE(desconto,0), COALESCE(valor_pago,0)
      INTO v_valor_atual, v_company, v_multa, v_juros_antes, v_desc_antes, v_pago_antes FROM erp_receber WHERE id = p_lancamento_id;
  ELSE
    SELECT valor, company_id, COALESCE(multa,0), COALESCE(juros,0), COALESCE(desconto,0), COALESCE(valor_pago,0)
      INTO v_valor_atual, v_company, v_multa, v_juros_antes, v_desc_antes, v_pago_antes FROM erp_pagar WHERE id = p_lancamento_id;
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

  -- REGRA ÚNICA: valor_pago = valor recebido = valor − desconto + juros + multa (o guarda de valor_pago gera a baixa
  -- da diferença; o trigger de status fecha 'pago'). Vale p/ conciliação simples e, chamada por fechar_agrupado, p/ a agrupada.
  v_net := round(v_valor_final + COALESCE(p_valor_juros,0) + COALESCE(v_multa,0) - COALESCE(p_valor_desconto,0), 2);

  IF p_tipo = 'receber' THEN
    UPDATE erp_receber SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), valor_pago = v_net, observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_pagar SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), valor_pago = v_net, observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  IF p_movimento_id IS NOT NULL THEN
    v_tabela := CASE WHEN p_tipo = 'receber' THEN 'erp_receber' ELSE 'erp_pagar' END;
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, v_tabela, p_lancamento_id,
             auth.uid(), 'ajuste', 'Conciliado após ajuste de valores') t;
    v_match_status := COALESCE(v_match->>'status_resultado', 'erro');
    IF v_match_status <> 'conciliado' THEN
      RAISE EXCEPTION 'Conciliação não aplicada: %', COALESCE(v_match->>'mensagem', 'não foi possível vincular o movimento')
        USING ERRCODE = 'P0001';
    END IF;
    -- guarda o estado ANTES do ajuste no vínculo recém-criado (p/ desfazer restaurar)
    UPDATE public.conciliacao_vinculo
       SET ajuste_juros_antes = v_juros_antes, ajuste_desconto_antes = v_desc_antes, ajuste_valor_pago_antes = v_pago_antes
     WHERE movimento_id = p_movimento_id AND lancamento_tabela = v_tabela AND lancamento_id = p_lancamento_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true,
    'valor_original', v_valor_atual, 'valor_novo', v_valor_final,
    'valor_ajustado', v_net, 'valor_pago', v_net,
    'juros', COALESCE(p_valor_juros,0), 'desconto', COALESCE(p_valor_desconto,0),
    'conciliado', (p_movimento_id IS NOT NULL AND v_match_status = 'conciliado'), 'match', v_match);
END $function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text, numeric, uuid) TO authenticated, service_role;

-- ───────── 3) fn_conciliacao_fechar_agrupado: guarda o estado-antes do âncora no vínculo (p/ desfazer) ─────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_receber uuid[] := '{}';
  v_pagar uuid[] := '{}';
  v_conta uuid;
  v_conta_nome text;
  v_j_antes numeric; v_d_antes numeric; v_p_antes numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;
  if not (v_interno or auth.role()='service_role' or v_mov.company_id in (select get_user_company_ids()) or is_admin()) then
    raise exception 'Sem acesso a esta empresa' using errcode='42501';
  end if;
  if v_mov.status = 'conciliado' then
    return jsonb_build_object('ok', true, 'conciliado', true, 'ja', true, 'valor', v_mov.valor);
  end if;
  select conta_bancaria_id into v_conta from conciliacao_lote where id = v_mov.lote_id;
  select nome into v_conta_nome from erp_banco_contas where id = v_conta;
  select coalesce(sum(valor_vinculado),0) into v_soma from conciliacao_vinculo where movimento_id = p_movimento_id;
  if v_soma = 0 then return jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada'); end if;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma, 'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    -- estado ANTES do ajuste, p/ o desfazer restaurar
    if v_anchor_tab = 'erp_pagar' then
      select coalesce(juros,0), coalesce(desconto,0), coalesce(valor_pago,0) into v_j_antes, v_d_antes, v_p_antes from erp_pagar where id = v_anchor;
    else
      select coalesce(juros,0), coalesce(desconto,0), coalesce(valor_pago,0) into v_j_antes, v_d_antes, v_p_antes from erp_receber where id = v_anchor;
    end if;

    perform fn_conciliacao_ajustar_valores(
      v_anchor, case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc, coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
    -- o acréscimo/desconto entra no valor vinculado do âncora (a baixa daquele movimento passa a ter o valor recebido)
    update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2),
           ajuste_juros_antes = v_j_antes, ajuste_desconto_antes = v_d_antes, ajuste_valor_pago_antes = v_p_antes
     where movimento_id = p_movimento_id and lancamento_tabela = v_anchor_tab and lancamento_id = v_anchor;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria = coalesce(nullif(btrim(conta_bancaria),''), v_conta_nome),
             forma_pagamento = coalesce(nullif(forma_pagamento,''), 'cartao_credito'), updated_at = now()
        where id = v_vin.lancamento_id;
      v_pagar := array_append(v_pagar, v_vin.lancamento_id);
    else
      update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria_id = coalesce(conta_bancaria_id, v_conta), updated_at = now()
        where id = v_vin.lancamento_id;
      v_receber := array_append(v_receber, v_vin.lancamento_id);
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=COALESCE(auth.uid(), p_operador_id) where id = p_movimento_id;

  perform public.fn_receber_conciliacao_sync(x) from unnest(v_receber) x;
  perform public.fn_pagar_conciliacao_sync(x) from unnest(v_pagar) x;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) TO authenticated, service_role;

-- ───────── 4) fn_conciliacao_desvincular_movimento: restaura juros/desconto/valor_pago do estado-antes e recalcula status ─────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_vin        RECORD;
  v_reabertos  int := 0;
  v_com_ajuste int := 0;
  v_ajuste_ids jsonb := '[]'::jsonb;
  v_receber    uuid[] := '{}';
  v_pagar      uuid[] := '{}';
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id) THEN
    IF v_mov.status = 'conciliado' AND v_mov.lancamento_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = p_movimento_id)
    THEN
      UPDATE public.conciliacao_movimento
         SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
             match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
             updated_at = now()
       WHERE id = p_movimento_id;
      RETURN jsonb_build_object('sucesso', true, 'movimento_id', p_movimento_id,
        'titulos_reabertos', 0, 'titulos_com_ajuste', 0, 'titulos_com_ajuste_ids', '[]'::jsonb,
        'liberado_sem_vinculo', true, 'aviso', NULL);
    END IF;
    IF v_mov.lancamento_id IS NULL AND v_mov.status = 'conciliado' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'baixa_ligada_sem_vinculo',
        'msg', 'Este movimento tem pagamento (baixa) ligado a ele, mas nenhum título na fatura. Desfaça o pagamento pelo histórico do título e tente de novo.');
    END IF;
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vinculos',
      'msg', 'Movimento sem vínculos agrupados. Para vínculo 1:1 use a desvinculação normal.');
  END IF;

  IF v_mov.status = 'conciliado' THEN
    FOR v_vin IN
      SELECT cv.lancamento_tabela, cv.lancamento_id, cv.valor_vinculado,
             cv.ajuste_juros_antes, cv.ajuste_desconto_antes, cv.ajuste_valor_pago_antes,
             ( cv.ajuste_valor_pago_antes IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.id = cv.lancamento_id
                        AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                             OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
               OR EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id
                        AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                             OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%')) ) AS had_ajuste
      FROM public.conciliacao_vinculo cv
      WHERE cv.movimento_id = p_movimento_id
    LOOP
      -- Restaura o estado ANTES do ajuste desta conciliação (quando guardado): juros/desconto/valor_pago.
      -- A mudança de valor_pago dispara o guarda (baixa de diferença) e recalcula o status.
      IF v_vin.ajuste_valor_pago_antes IS NOT NULL THEN
        IF v_vin.lancamento_tabela = 'erp_pagar' THEN
          UPDATE public.erp_pagar SET juros = v_vin.ajuste_juros_antes, desconto = v_vin.ajuste_desconto_antes,
                 valor_pago = v_vin.ajuste_valor_pago_antes, updated_at = now()
           WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        ELSE
          UPDATE public.erp_receber SET juros = v_vin.ajuste_juros_antes, desconto = v_vin.ajuste_desconto_antes,
                 valor_pago = v_vin.ajuste_valor_pago_antes, updated_at = now()
           WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        END IF;
      END IF;

      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_pagar := array_append(v_pagar, v_vin.lancamento_id);
      ELSE
        UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_receber := array_append(v_receber, v_vin.lancamento_id);
      END IF;

      v_reabertos := v_reabertos + 1;
      IF v_vin.had_ajuste THEN
        v_com_ajuste := v_com_ajuste + 1;
        v_ajuste_ids := v_ajuste_ids || to_jsonb(v_vin.lancamento_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  PERFORM public.fn_receber_conciliacao_sync(x) FROM unnest(v_receber) x;
  PERFORM public.fn_pagar_conciliacao_sync(x) FROM unnest(v_pagar) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'titulos_reabertos', v_reabertos,
    'titulos_com_ajuste', v_com_ajuste,
    'titulos_com_ajuste_ids', v_ajuste_ids,
    'aviso', CASE WHEN v_com_ajuste > 0
      THEN format('%s título(s) tinham ajuste de juros/desconto: restaurado o estado anterior; confira se precisar.', v_com_ajuste)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) TO authenticated, service_role;

-- ───────── 5) triggers de status: reconciliar (conciliado / movimento_banco_id) também recalcula o status ─────────
DROP TRIGGER IF EXISTS trg_status_receber ON public.erp_receber;
CREATE TRIGGER trg_status_receber BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status, valor_pago, desconto, multa, juros, conciliado, movimento_banco_id
  ON public.erp_receber FOR EACH ROW EXECUTE FUNCTION fn_trg_status_lancamento();
DROP TRIGGER IF EXISTS trg_status_pagar ON public.erp_pagar;
CREATE TRIGGER trg_status_pagar BEFORE INSERT OR UPDATE OF data_vencimento, data_pagamento, status, valor_pago, desconto, multa, juros, conciliado, movimento_banco_id
  ON public.erp_pagar FOR EACH ROW EXECUTE FUNCTION fn_trg_status_lancamento();

-- ───────── 6) correção de dado (autorizada pelo CEO), idempotente ─────────
-- Títulos conciliados com juros/multa em que o valor_pago cobre só o PRINCIPAL (valor − desconto) e NÃO somou os
-- juros/multa recebidos → valor_pago = valor − desconto + juros + multa. O guarda de valor_pago gera a baixa da
-- diferença e o trigger fecha 'pago'; a soma das baixas passa a bater com o crédito do banco.
-- SEGURANÇA (não inventar pagamento): só corrige quando a CONCILIAÇÃO prova que o banco creditou o líquido inteiro
-- (soma dos vínculos conciliados do título >= net). Pagamento parcial de verdade (cliente pagou o principal e ainda
-- deve os juros) tem vínculo = principal, não net, e fica de fora.
-- NB: o manual falava em status 'parcial', mas o #10136 reclassifica para 'pago' assim que o valor_pago cobre o valor
-- original — por isso o recorte é pelo DÉFICIT de valor_pago + prova de conciliação, não pelo rótulo.
-- Idempotente: depois da correção valor_pago = net, então o recorte "valor_pago < net" deixa de casar.
UPDATE public.erp_receber AS r
   SET valor_pago = round(r.valor - COALESCE(r.desconto,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0), 2), updated_at = now()
 WHERE r.conciliado = true AND r.deleted_at IS NULL AND COALESCE(r.juros,0) + COALESCE(r.multa,0) > 0
   AND lower(btrim(COALESCE(r.status,''))) NOT IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto')
   AND COALESCE(r.valor_pago,0) >= round(r.valor - COALESCE(r.desconto,0), 2) - 0.01
   AND COALESCE(r.valor_pago,0) <  round(r.valor - COALESCE(r.desconto,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0), 2) - 0.01
   AND ( SELECT COALESCE(sum(v.valor_vinculado),0)
           FROM public.conciliacao_vinculo v JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
          WHERE v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = r.id AND m.status = 'conciliado' )
       >= round(r.valor - COALESCE(r.desconto,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0), 2) - 0.01;

UPDATE public.erp_pagar AS p
   SET valor_pago = round(p.valor - COALESCE(p.desconto,0) + COALESCE(p.juros,0) + COALESCE(p.multa,0), 2), updated_at = now()
 WHERE p.conciliado = true AND p.deleted_at IS NULL AND COALESCE(p.juros,0) + COALESCE(p.multa,0) > 0
   AND lower(btrim(COALESCE(p.status,''))) NOT IN ('cancelado','cancelled','canceled','renegociado','estornado','previsto')
   AND COALESCE(p.valor_pago,0) >= round(p.valor - COALESCE(p.desconto,0), 2) - 0.01
   AND COALESCE(p.valor_pago,0) <  round(p.valor - COALESCE(p.desconto,0) + COALESCE(p.juros,0) + COALESCE(p.multa,0), 2) - 0.01
   AND ( SELECT COALESCE(sum(v.valor_vinculado),0)
           FROM public.conciliacao_vinculo v JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
          WHERE v.lancamento_tabela = 'erp_pagar' AND v.lancamento_id = p.id AND m.status = 'conciliado' )
       >= round(p.valor - COALESCE(p.desconto,0) + COALESCE(p.juros,0) + COALESCE(p.multa,0), 2) - 0.01;
