-- 🚨 Saneamento Onda 1 · Lote 2a — conciliação (núcleo: vincular/fechar/desvincular + leitura + pluggy + trigger).
-- Inventário #1560. Contexto 6b5cad70. RDs 25·38·52·65·34-V5. Todas eram SECURITY DEFINER abertas p/ anon
-- e sem guarda de empresa → mutar/ler conciliação de QUALQUER empresa sem login.
-- Empresa resolvida pela LINHA (conciliacao_movimento/conciliacao_vinculo/wealth_pluggy_items).
-- Sem JWT (interno/cron)/service_role/admin passa; authenticated só na própria empresa → 42501.
-- REVOKE anon/public; GRANT authenticated, service_role. Trigger → ACL-only. Corpos reproduzidos fiéis.

-- ── fn_conciliacao_vincular (empresa = movimento) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_valor numeric DEFAULT NULL::numeric, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD; v_comp uuid; v_valor numeric; v_saldo numeric;
  v_titulo_valor numeric; v_titulo_pago numeric; v_titulo_jur numeric; v_titulo_dsc numeric; v_liq numeric;
  v_ja_vinc numeric;
  v_soma numeric; v_qtd int; v_fecha boolean; v_match jsonb := NULL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  v_comp := v_mov.company_id;
  IF NOT (v_interno OR auth.role()='service_role' OR v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
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
    v_valor := LEAST(round(abs(v_mov.valor),2), GREATEST(CASE WHEN v_saldo > 0.01 THEN v_saldo ELSE v_liq END, 0));
  ELSE
    v_valor := round(p_valor,2);
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','valor deve ser positivo (título sem valor líquido?)'); END IF;

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
    IF COALESCE(v_match->>'status_resultado','') = 'conciliado' THEN
      IF p_lancamento_tabela = 'erp_pagar' THEN
        UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
      ELSE
        UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
      END IF;
    ELSE
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

-- ── fn_conciliacao_vinculos (leitura; empresa = movimento) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vinculos(p_movimento_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD;
  v_itens jsonb;
  v_soma numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_mov.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'vinculo_id', v.id,
      'tabela', v.lancamento_tabela,
      'lancamento_id', v.lancamento_id,
      'valor', v.valor_vinculado,
      'contraparte', COALESCE(p.fornecedor_nome, r.cliente_nome, p.descricao, r.descricao),
      'descricao', COALESCE(p.descricao, r.descricao),
      'vencimento', COALESCE(p.data_vencimento, r.data_vencimento)
    ) ORDER BY v.criado_em), '[]'::jsonb),
    COALESCE(sum(v.valor_vinculado), 0)
    INTO v_itens, v_soma
  FROM conciliacao_vinculo v
  LEFT JOIN erp_pagar   p ON v.lancamento_tabela = 'erp_pagar'   AND p.id = v.lancamento_id
  LEFT JOIN erp_receber r ON v.lancamento_tabela = 'erp_receber' AND r.id = v.lancamento_id
  WHERE v.movimento_id = p_movimento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_mov.valor,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_mov.valor) - v_soma, 2),
    'fecha', (abs(abs(v_mov.valor) - v_soma) <= 0.05),
    'itens', v_itens
  );
END;
$function$;

-- ── fn_conciliacao_desvincular_item (empresa = vínculo) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_item(p_vinculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mov uuid;
  v_comp uuid;
  v_val numeric;
  v_soma numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT movimento_id, company_id INTO v_mov, v_comp FROM conciliacao_vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vinculo nao encontrado');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  DELETE FROM conciliacao_vinculo WHERE id = p_vinculo_id;

  SELECT valor INTO v_val FROM conciliacao_movimento WHERE id = v_mov;
  SELECT COALESCE(sum(valor_vinculado), 0) INTO v_soma
    FROM conciliacao_vinculo WHERE movimento_id = v_mov;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_val,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_val) - v_soma, 2),
    'fecha', (abs(abs(v_val) - v_soma) <= 0.05)
  );
END;
$function$;

-- ── fn_conciliacao_fechar_agrupado (empresa = movimento) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_ja_pago boolean; v_liq numeric; v_pago numeric;
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
    perform fn_conciliacao_ajustar_valores(
      v_anchor, case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc, coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      select round(valor + coalesce(juros,0) - coalesce(desconto,0),2), coalesce(valor_pago,0)
        into v_liq, v_pago from erp_pagar where id = v_vin.lancamento_id;
      v_ja_pago := (v_pago + 0.01 >= v_liq);
      if v_ja_pago then
        update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
          where id = v_vin.lancamento_id;
      else
        update erp_pagar set status='pago',
          valor_pago = round(v_vin.valor_vinculado + case when v_vin.lancamento_id = v_anchor then v_acr - v_desc else 0 end, 2),
          data_pagamento = v_mov.data_transacao, forma_pagamento = coalesce(forma_pagamento, 'cartao_credito'),
          conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
         where id = v_vin.lancamento_id;
      end if;
    else
      select round(valor + coalesce(juros,0) - coalesce(desconto,0),2), coalesce(valor_pago,0)
        into v_liq, v_pago from erp_receber where id = v_vin.lancamento_id;
      v_ja_pago := (v_pago + 0.01 >= v_liq);
      if v_ja_pago then
        update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
          where id = v_vin.lancamento_id;
      else
        update erp_receber set status='pago',
          valor_pago = round(v_vin.valor_vinculado + case when v_vin.lancamento_id = v_anchor then v_acr - v_desc else 0 end, 2),
          data_pagamento = v_mov.data_transacao,
          conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
         where id = v_vin.lancamento_id;
      end if;
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=p_operador_id where id = p_movimento_id;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;

-- ── sp_pluggy_promover_para_conciliacao (empresa = wealth_pluggy_items) ───────────────────────────
CREATE OR REPLACE FUNCTION public.sp_pluggy_promover_para_conciliacao(p_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_accounts_raw jsonb;
  v_transactions_raw jsonb;
  v_account jsonb;
  v_tx jsonb;
  v_conta_id uuid;
  v_lote_id uuid;
  v_acc_id text;
  v_acc_nome text;
  v_banco text;
  v_subtype text;
  v_qtd_contas int := 0;
  v_qtd_inseridas int := 0;
  v_qtd_ja_existiam int := 0;
  v_id_ext text;
  v_valor numeric;
  v_natureza text;
  v_data date;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT id, company_id, metadata, pluggy_item_id INTO v_item
  FROM wealth_pluggy_items WHERE id = p_item_id;
  IF v_item IS NULL OR COALESCE(v_item.metadata->>'contexto','') <> 'financeiro' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item nao e contexto financeiro');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_item.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  SELECT payload INTO v_accounts_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'accounts'
  ORDER BY recebido_em DESC LIMIT 1;

  SELECT payload INTO v_transactions_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'transactions'
  ORDER BY recebido_em DESC LIMIT 1;

  IF v_accounts_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem raw accounts ainda; aguarde sync');
  END IF;

  FOR v_account IN
    SELECT * FROM jsonb_array_elements(COALESCE(v_accounts_raw->'results', '[]'::jsonb))
    WHERE (value->>'type') = 'BANK'
  LOOP
    v_acc_id   := v_account->>'id';
    v_acc_nome := COALESCE(v_account->>'name', v_account->>'marketingName', 'Conta bancaria');
    v_subtype  := v_account->>'subtype';
    v_banco    := COALESCE(v_account->'bankData'->>'transferNumber', v_account->>'number', '');
    v_qtd_contas := v_qtd_contas + 1;

    SELECT id INTO v_conta_id
    FROM erp_banco_contas
    WHERE company_id = v_item.company_id AND pluggy_account_id = v_acc_id;

    IF v_conta_id IS NULL THEN
      INSERT INTO erp_banco_contas (
        company_id, nome, banco, conta, tipo_conta,
        saldo_inicial, saldo_atual, ativo,
        incluir_no_fluxo, soma_no_saldo, incluir_no_resumo,
        pluggy_item_id, pluggy_account_id
      ) VALUES (
        v_item.company_id,
        v_acc_nome,
        COALESCE(v_account->>'marketingName', ''),
        v_banco,
        LOWER(COALESCE(v_subtype, 'corrente')),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        true, true, true, true,
        v_item.pluggy_item_id,
        v_acc_id
      ) RETURNING id INTO v_conta_id;
    ELSE
      UPDATE erp_banco_contas SET
        saldo_atual = COALESCE(NULLIF(v_account->>'balance','')::numeric, saldo_atual),
        updated_at  = now()
      WHERE id = v_conta_id;
    END IF;

    SELECT id INTO v_lote_id
    FROM conciliacao_lote
    WHERE company_id = v_item.company_id
      AND conta_bancaria_id = v_conta_id
      AND origem = 'api_pluggy'
      AND status = 'aberto'
    LIMIT 1;
    IF v_lote_id IS NULL THEN
      INSERT INTO conciliacao_lote (
        company_id, tipo, origem, nome, conta_bancaria_id, status
      ) VALUES (
        v_item.company_id, 'bancario', 'api_pluggy',
        'Pluggy · ' || v_acc_nome,
        v_conta_id, 'aberto'
      ) RETURNING id INTO v_lote_id;
    END IF;

    IF v_transactions_raw IS NOT NULL THEN
      FOR v_tx IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_transactions_raw->'results', '[]'::jsonb))
        WHERE (value->>'accountId') = v_acc_id
      LOOP
        v_id_ext   := 'pluggy:' || (v_tx->>'id');
        v_valor    := COALESCE(NULLIF(v_tx->>'amount','')::numeric, 0);
        v_natureza := CASE WHEN v_valor >= 0 THEN 'credito' ELSE 'debito' END;
        v_valor    := ABS(v_valor);
        v_data     := COALESCE((v_tx->>'date')::date, CURRENT_DATE);

        BEGIN
          INSERT INTO conciliacao_movimento (
            lote_id, company_id,
            data_transacao, valor, natureza, descricao, id_externo, status
          ) VALUES (
            v_lote_id, v_item.company_id,
            v_data, v_valor, v_natureza,
            COALESCE(v_tx->>'description', v_tx->>'descriptionRaw', '—'),
            v_id_ext, 'pendente'
          );
          v_qtd_inseridas := v_qtd_inseridas + 1;
        EXCEPTION WHEN unique_violation THEN
          v_qtd_ja_existiam := v_qtd_ja_existiam + 1;
        END;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE wealth_pluggy_items
  SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('last_conciliacao_em', now())
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'qtd_contas_bank', v_qtd_contas,
    'qtd_movimentos_inseridos', v_qtd_inseridas,
    'qtd_movimentos_ja_existiam', v_qtd_ja_existiam,
    'tabela_alvo', 'erp_banco_contas'
  );
END;
$function$;

-- ── ACL ───────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_vincular(uuid,text,uuid,numeric,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_vincular(uuid,text,uuid,numeric,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_vinculos(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_vinculos(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_item(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_item(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sp_pluggy_promover_para_conciliacao(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.sp_pluggy_promover_para_conciliacao(uuid) TO authenticated, service_role;

-- Trigger (só a trigger invoca; já tem CHECK multi-tenant interno) → ACL-only.
REVOKE EXECUTE ON FUNCTION public.fn_baixa_por_conciliacao() FROM anon, authenticated, public;
