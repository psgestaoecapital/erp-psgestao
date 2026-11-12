-- Chamado #3866 (AJUSTE) — forward-fix: a conciliação passa a GRAVAR a conta bancária
-- no título a receber no ato, para não voltar a nascer título conciliado sem conta.
--
-- Caminhos de fechamento que marcavam erp_receber.conciliado = true sem gravar conta_bancaria_id:
--   1) fn_conciliacao_aplicar_match  (match 1:1, automático e o chamado por fn_conciliacao_vincular)
--   2) fn_conciliacao_fechar_agrupado (fatura agrupada, vários títulos num movimento)
-- A conta vem do lote da conciliação (conciliacao_lote.conta_bancaria_id) do próprio movimento.
-- Usa COALESCE(conta_bancaria_id, v_conta): só preenche quando está vazia (nunca sobrescreve) e,
-- em lote de cartão (lote sem conta bancária), v_conta é NULL e a conta fica como está.
-- erp_pagar NÃO tem coluna conta_bancaria_id, então o ajuste é só no ramo de receber.
--
-- Mudança MÍNIMA: reproduz as duas funções idênticas, acrescentando só a declaração v_conta,
-- a leitura da conta do lote e a coluna no UPDATE de erp_receber. Nada mais muda.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE v_mov RECORD; v_score numeric; v_ja numeric; v_liq numeric; v_conta uuid;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;
  -- #3866: conta bancária do lote do movimento, para gravar no título a receber
  SELECT conta_bancaria_id INTO v_conta FROM public.conciliacao_lote WHERE id = v_mov.lote_id;
  SELECT COALESCE(SUM(valor),0) INTO v_ja FROM public.conciliacao_movimento
    WHERE lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id AND status = 'conciliado' AND id <> p_movimento_id;
  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_pagar WHERE id = p_lancamento_id;
  ELSIF p_lancamento_tabela = 'erp_receber' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_receber WHERE id = p_lancamento_id;
  END IF;
  IF v_liq IS NOT NULL AND round(v_ja + v_mov.valor, 2) > v_liq + 0.01 THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Este título já foi conciliado (valor já coberto). Não vou duplicar a baixa.'::text; RETURN;
  END IF;
  IF p_lancamento_tabela = 'erp_pagar' THEN
    -- o débito pode estar pagando o saldo ou confirmando uma baixa já registrada — não só o valor cheio
    SELECT CASE WHEN abs(COALESCE(public.fn_pagar_valor_referencia(p.id, v_mov.valor), p.valor) - abs(v_mov.valor)) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_pagar p WHERE p.id = p_lancamento_id;
  ELSE
    SELECT CASE WHEN abs(COALESCE(public.fn_receber_valor_referencia(r.id, v_mov.valor), r.valor) - abs(v_mov.valor)) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_receber r WHERE r.id = p_lancamento_id;
  END IF;
  IF COALESCE(v_score,0) < 70 AND COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Match de baixa confiança (score '||COALESCE(v_score,0)::text||'). Informe o motivo para confirmar.'; RETURN;
  END IF;
  UPDATE conciliacao_movimento
     SET lancamento_tabela = p_lancamento_tabela, lancamento_id = p_lancamento_id,
         match_score = v_score, match_origem = p_origem, match_aplicado_em = now(),
         match_aplicado_por = p_operador_id, status = 'conciliado',
         obs = CASE WHEN COALESCE(btrim(p_motivo),'')<>'' THEN left('[match '||COALESCE(v_score,0)::text||'] '||p_motivo, 500) ELSE obs END,
         updated_at = now()
   WHERE id = p_movimento_id;

  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_mov.company_id, p_lancamento_tabela, p_lancamento_id, round(abs(v_mov.valor),2), p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE SET valor_vinculado = EXCLUDED.valor_vinculado;

  IF p_lancamento_tabela = 'erp_pagar' THEN
    UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id,
           conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta), updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  IF length(v_mov.descricao_normalizada) >= 5 THEN
    INSERT INTO conciliacao_regra (company_id, tipo_lote, padrao_descricao, padrao_tipo, sugestao_psgc, origem, hits_total, hits_aceitos, ultima_aplicacao)
    SELECT v_mov.company_id, cl.tipo, substring(v_mov.descricao_normalizada FROM 1 FOR LEAST(30, length(v_mov.descricao_normalizada))),
           'substring', v_mov.psgc_sugestao, 'aprendido', 1, 1, now()
    FROM conciliacao_lote cl WHERE cl.id = v_mov.lote_id
    ON CONFLICT (company_id, tipo_lote, padrao_descricao) DO UPDATE
      SET hits_total = conciliacao_regra.hits_total + 1, hits_aceitos = conciliacao_regra.hits_aceitos + 1, ultima_aplicacao = now(), updated_at = now();
  END IF;
  RETURN QUERY SELECT p_movimento_id, 'conciliado', 'Match aplicado com score ' || v_score::text;
END; $function$;


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
  -- #3866: conta bancária do lote do movimento, para gravar nos títulos a receber
  select conta_bancaria_id into v_conta from conciliacao_lote where id = v_mov.lote_id;
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
    -- o acréscimo/desconto entra no valor vinculado do título-âncora (a baixa daquele movimento passa a ter
    -- o valor efetivamente pago/recebido; a soma dos vínculos fecha com o extrato) — receber e pagar
    update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2)
     where movimento_id = p_movimento_id and lancamento_tabela = v_anchor_tab and lancamento_id = v_anchor;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      -- pagar não grava mais valor_pago aqui; a baixa nasce (ou é reaproveitada) no sync abaixo
      update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id,
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

-- check_fn_guards (Regra 1): REVOKE anon na fn SECURITY DEFINER fn_conciliacao_fechar_agrupado.
-- Espelha a ACL viva de hoje {postgres(owner), authenticated, service_role}; anon/PUBLIC nunca tiveram
-- acesso — nenhuma mudança de acesso. (fn_conciliacao_aplicar_match é SECURITY INVOKER, fora da regra.)
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) TO authenticated, service_role;
