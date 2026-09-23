-- Oficina · #105 (renegociação) — PR2 (banco). Só banco (a tela acompanha no mesmo PR).
--
-- Chamado da Jordana: a tela de acerto "mostra somente boleto; deve mostrar todas as formas de pagamento".
-- Numa oficina, dinheiro e PIX são o caso comum, e acerto misto (entrada em dinheiro + restante em boleto)
-- é o padrão. Hoje fn_renegociacao_criar grava os títulos SEM forma_pagamento (implicitamente boleto).
--
-- Mudança: p_boletos passa a aceitar `forma_pagamento` por parcela; o título gerado grava a forma.
-- Backward-compat: parcela sem forma → 'boleto' (comportamento anterior). SÓ boleto entra na emissão/
-- remessa CNAB — as demais formas (dinheiro/pix/cartão/transferência/…) gravam o título e ficam de fora
-- (a tela oferece "emitir boletos" apenas para as parcelas forma='boleto').
--
-- Preserva TUDO do PR1 (#1727): guarda de datas não-decrescente + avisos. RD-52 · RD-38.

CREATE OR REPLACE FUNCTION public.fn_renegociacao_criar(p_company uuid, p_cliente uuid, p_conta uuid, p_origem_ids uuid[], p_boletos jsonb, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reneg uuid; v_origem numeric := 0; v_gerado numeric := 0; v_ajuste numeric; v_n_eleg int;
  v_cli_nome text; v_mes text := to_char(current_date,'MM/YYYY'); v_ids uuid[] := '{}'; b jsonb; v_new uuid; i int := 0;
  v_n int; v_idx int; v_venc date; v_prev_venc date; v_base_venc date; v_avisos jsonb := '[]'::jsonb;
  v_forma text;
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF p_origem_ids IS NULL OR array_length(p_origem_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','sem_origens'); END IF;
  IF p_boletos IS NULL OR jsonb_array_length(p_boletos)=0 THEN RETURN jsonb_build_object('sucesso',false,'erro','sem_boletos'); END IF;

  -- GUARDA DE DATAS (#105 PR1): vencimentos em ordem NÃO-decrescente (iguais válidas). Recusa "salto de ano".
  v_n := jsonb_array_length(p_boletos); v_idx := 0; v_prev_venc := NULL; v_base_venc := NULL;
  FOR b IN SELECT * FROM jsonb_array_elements(p_boletos) LOOP
    v_idx := v_idx + 1;
    v_venc := (b->>'data_vencimento')::date;
    IF v_venc IS NULL THEN RAISE EXCEPTION 'Parcela %/%: vencimento vazio.', v_idx, v_n; END IF;
    IF v_base_venc IS NULL THEN v_base_venc := v_venc; END IF;
    IF v_prev_venc IS NOT NULL AND v_venc < v_prev_venc THEN
      RAISE EXCEPTION 'Datas fora de ordem: parcela %/% vence % (antes da anterior, %). Confira o ANO — provável erro de digitação.',
        v_idx, v_n, to_char(v_venc,'DD/MM/YYYY'), to_char(v_prev_venc,'DD/MM/YYYY');
    END IF;
    IF v_venc > (v_base_venc + make_interval(months => v_n + 3))::date THEN
      v_avisos := v_avisos || jsonb_build_object('parcela', v_idx, 'data_vencimento', to_char(v_venc,'YYYY-MM-DD'),
        'aviso', 'vencimento muito distante da 1ª parcela ('||to_char(v_base_venc,'DD/MM/YYYY')||') — confira o ano');
    END IF;
    v_prev_venc := v_venc;
  END LOOP;

  SELECT count(*), COALESCE(sum(valor),0) INTO v_n_eleg, v_origem FROM public.erp_receber
   WHERE id = ANY(p_origem_ids) AND company_id = p_company AND deleted_at IS NULL
     AND status IN ('aberto','vencido') AND renegociacao_id IS NULL
     AND (p_cliente IS NULL OR cliente_id = p_cliente);
  IF v_n_eleg <> array_length(p_origem_ids,1) THEN
    RAISE EXCEPTION 'Uma ou mais origens não são elegíveis (empresa/cliente/status/já em acerto).'; END IF;

  SELECT COALESCE(sum((x->>'valor')::numeric),0) INTO v_gerado FROM jsonb_array_elements(p_boletos) x;
  v_ajuste := round(v_gerado - v_origem, 2);
  IF abs(v_ajuste) > 0.01 AND COALESCE(btrim(p_observacao),'') = '' THEN
    RAISE EXCEPTION 'Ajuste de R$ % exige um motivo (observação).', to_char(v_ajuste,'FM999999990.00'); END IF;

  SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli_nome FROM public.erp_clientes WHERE id = p_cliente;
  v_cli_nome := COALESCE(v_cli_nome, 'cliente');

  INSERT INTO public.erp_renegociacao (company_id, cliente_id, conta_bancaria_id, valor_origem, valor_gerado, ajuste, status, observacao, criado_por)
  VALUES (p_company, p_cliente, p_conta, v_origem, v_gerado, v_ajuste, 'confirmada', p_observacao, auth.uid())
  RETURNING id INTO v_reneg;

  INSERT INTO public.erp_renegociacao_origem (company_id, renegociacao_id, receber_origem_id, valor)
  SELECT p_company, v_reneg, r.id, r.valor FROM public.erp_receber r WHERE r.id = ANY(p_origem_ids);

  UPDATE public.erp_receber SET status='renegociado', renegociacao_id=v_reneg,
    observacoes = COALESCE(observacoes,'') || ' [RENEGOCIADO no acerto '||left(v_reneg::text,8)||' em '||to_char(current_date,'DD/MM/YYYY')||' — ver boletos]',
    updated_at = now()
  WHERE id = ANY(p_origem_ids);

  -- Gera os recebíveis do acerto, agora COM forma_pagamento por parcela (default 'boleto' p/ compat).
  -- Só forma='boleto' será oferecida para emissão de boleto/CNAB pela tela.
  FOR b IN SELECT * FROM jsonb_array_elements(p_boletos) LOOP
    i := i + 1;
    v_forma := lower(NULLIF(btrim(COALESCE(b->>'forma_pagamento','')), ''));
    v_forma := COALESCE(v_forma, 'boleto');
    INSERT INTO public.erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      conta_bancaria_id, renegociacao_id, status, forma_pagamento, observacoes)
    VALUES (p_company, p_cliente, v_cli_nome,
      'Acerto '||v_cli_nome||' · '||v_mes||' · '||i||'/'||jsonb_array_length(p_boletos),
      (b->>'valor')::numeric, (b->>'data_vencimento')::date, p_conta, v_reneg, 'aberto', v_forma,
      'Acerto (renegociação '||left(v_reneg::text,8)||') — '||array_length(p_origem_ids,1)||' título(s) de origem')
    RETURNING id INTO v_new;
    v_ids := array_append(v_ids, v_new);
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'renegociacao_id', v_reneg,
    'valor_origem', v_origem, 'valor_gerado', v_gerado, 'ajuste', v_ajuste, 'gerados', to_jsonb(v_ids),
    'avisos', v_avisos);
END $function$;

REVOKE ALL ON FUNCTION public.fn_renegociacao_criar(uuid,uuid,uuid,uuid[],jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_renegociacao_criar(uuid,uuid,uuid,uuid[],jsonb,text) TO authenticated, service_role;
