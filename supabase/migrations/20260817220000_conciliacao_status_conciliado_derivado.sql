-- Conciliação · "Conciliado" (Pago ≠ Conciliado) + fix "pago não concilia" (RD-41, validado c/ Jordana)
--
-- DECISÃO (Code Web): "Conciliado" é DERIVADO do booleano que já existe (erp_pagar/erp_receber.conciliado),
-- NÃO um novo valor de status. Motivo (auditado RD-38): 63 funções de dinheiro (DRE/DFC/balanço/fluxo/
-- painéis) filtram status='pago'; trocar 'pago' por 'conciliado' quebraria todas. Então o status continua
-- 'pago' (relatórios seguem certos) e "Conciliado" = pago + conciliado=true. Régua de exibição:
-- Aberto → Agendado → Vencido → Pago → Conciliado.
--
-- Aqui:
--   1c FIX: fn_conciliacao_vincular deixava título PAGO fora (saldo=0 → "valor deve ser positivo"). Agora
--      um pago é candidato válido: conciliar CARIMBA (não consome saldo) — usa o líquido como base do vínculo.
--   Carimbo conciliado=true em TODOS os caminhos (1:1 aplicar_match, agrupado fechar_agrupado; vincular já fazia).
--   fechar_agrupado: título já pago NÃO re-baixa (só carimba) — nada de baixa dupla.
--   v_titulos_consolidados: expõe `conciliado` e status_calculado='conciliado' (display; não toca as 63 funções).
-- ⚠️ Mexe em status/baixa de títulos reais → reauditoria profunda pós-merge (RD-53).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) FIX 1c + carimbo no vínculo/1:1
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_valor numeric DEFAULT NULL::numeric, p_operador_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    IF p_lancamento_tabela = 'erp_pagar' THEN
      UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
    ELSE
      UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'valor_vinculado', v_valor, 'valor_movimento', abs(v_mov.valor),
    'soma_vinculada', v_soma, 'saldo_movimento', round(abs(v_mov.valor) - v_soma, 2), 'qtd_vinculos', v_qtd,
    'fecha', v_fecha, 'conciliado_1x1', (v_fecha AND v_qtd = 1),
    'split_pendente_fase2', (v_soma < abs(v_mov.valor) - 0.05), 'match', v_match);
END; $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 1:1 aplicar_match: carimba conciliado=true no título (cobre o caminho de aplicar sugestão direto,
--    que não passa pelo vincular). A baixa continua a cargo do trigger→fn_recompute_baixa_titulo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text) LANGUAGE plpgsql
AS $function$
DECLARE v_mov RECORD; v_score numeric; v_ja numeric; v_liq numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;
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
    SELECT CASE WHEN abs(p.valor - v_mov.valor) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_pagar p WHERE p.id = p_lancamento_id;
  ELSE
    SELECT CASE WHEN abs(r.valor - v_mov.valor) < 0.01 THEN 50 ELSE 25 END
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

  -- carimbo "Conciliado" (o trigger de baixa já rodou na linha acima; aqui só marca o booleano derivado)
  IF p_lancamento_tabela = 'erp_pagar' THEN
    UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Agrupado: carimba conciliado=true; título já PAGO NÃO re-baixa (só carimba) — nada de baixa dupla.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_ja_pago boolean; v_liq numeric; v_pago numeric;
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;
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
        -- já pago (ex.: lote da remessa): NÃO re-baixa; só carimba conciliado
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) View consolidada: expõe `conciliado` e o status_calculado 'conciliado' (DISPLAY — não toca as 63 funções).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_titulos_consolidados AS
 SELECT p.id, p.company_id, 'pagar'::text AS tipo, p.descricao, p.fornecedor_nome AS contraparte_nome,
    p.fornecedor_id AS contraparte_id, p.categoria, p.valor, p.valor_pago, p.data_emissao, p.data_vencimento,
    p.data_pagamento, p.data_previsao, p.status, p.numero_documento, p.numero_nf, p.linha_negocio,
    p.created_at, p.updated_at,
    CASE
      WHEN p.status::text = 'pago'::text AND p.conciliado THEN 'conciliado'::text
      WHEN p.status::text = 'pago'::text THEN 'pago'::text
      WHEN p.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN p.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN p.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN p.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN p.data_previsao IS NOT NULL AND p.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado,
    p.conciliado
   FROM erp_pagar p
UNION ALL
 SELECT r.id, r.company_id, 'receber'::text AS tipo, r.descricao, r.cliente_nome AS contraparte_nome,
    r.cliente_id AS contraparte_id, r.categoria, r.valor, r.valor_pago, r.data_emissao, r.data_vencimento,
    r.data_pagamento, r.data_previsao, r.status, r.numero_documento, r.numero_nf, r.linha_negocio,
    r.created_at, r.updated_at,
    CASE
      WHEN r.status::text = 'pago'::text AND r.conciliado THEN 'conciliado'::text
      WHEN r.status::text = 'pago'::text THEN 'pago'::text
      WHEN r.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN r.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN r.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN r.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN r.data_previsao IS NOT NULL AND r.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado,
    r.conciliado
   FROM erp_receber r;
