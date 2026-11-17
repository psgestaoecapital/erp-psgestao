-- Chamado #3740 (Jordana · piloto Gean, vale para TODAS as empresas) · item 1 do AJUSTE 17/11.
--
-- ANTES (migration 20261021033220): cada parcela de repasse de cartão gerava DOIS lançamentos:
--   (a) o título de repasse em nome da operadora (erp_receber, valor = BRUTO) e
--   (b) uma conta a pagar de taxa (erp_pagar, categoria 'taxa_cartao'), vinculada por taxa_pagar_id.
-- Efeito ruim: a taxa virava "despesa financeira" (conta a pagar aberta/vencida) e o DRE/fluxo de caixa
-- enxergavam o bruto na receita e a taxa como despesa — além de 3 contas a pagar por venda (uma por parcela).
--
-- AGORA (pedido da Jordana): a taxa é um DESCONTO no próprio título da operadora. O título guarda o valor
-- BRUTO em `valor` e a taxa em `desconto`; o "a receber" (valor − desconto) é exatamente o LÍQUIDO que a
-- operadora deposita. NÃO se cria mais conta a pagar de taxa, nem se preenche taxa_pagar_id nos NOVOS
-- lançamentos. As colunas valor_taxa/valor_liquido/data_repasse continuam preenchidas (usadas na conciliação
-- e na exibição). Recebimentos antigos NÃO mudam (nenhum UPDATE em dado existente; o ajuste em lote da Gean é
-- item 4, em PR própria com backup e prova antes/depois).
--
-- Consistência provada na definição viva (RD-38):
--  * fn_trg_status_lancamento calcula o saldo como (valor + juros + multa − DESCONTO − valor_pago): com
--    desconto = taxa, o título fecha em 'pago' exatamente quando valor_pago = líquido.
--  * fn_trg_cartao_repasse_fechar: para o novo título o resíduo (valor − desconto − soma_baixas) = 0, então o
--    gatilho NÃO insere baixa de taxa nem mexe em taxa_pagar (NULL) — o título fecha pelo próprio líquido.
--  * fn_cartao_conciliar_repasse: passa a baixar o título pelo LÍQUIDO (valor − desconto), não pelo bruto.
--  * fn_receber_valor_referencia já oferece valor_liquido como valor possível do título de repasse (inalterado).

-- 1) registrar o recebimento em cartão: taxa como desconto, sem conta a pagar -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cartao_registrar_recebimento(p_company_id uuid, p_receber_id uuid, p_adquirente_id uuid,
  p_bandeira text, p_modalidade text, p_parcelas integer, p_data_venda date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; calc jsonb; v_adq text; v_pct numeric; v_prazo int; v_total numeric; v_n int; v_mod text; v_band text;
        v_bruto numeric; v_acum numeric := 0; v_taxa numeric; v_liq numeric; v_repasse date; v_novo uuid; v_taxa_pagar uuid;
        v_parcelas jsonb := '[]'::jsonb; v_data date := COALESCE(p_data_venda, CURRENT_DATE); i int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;

  v_band := NULLIF(btrim(COALESCE(p_bandeira,'')), '');
  v_mod  := lower(btrim(COALESCE(p_modalidade,'')));
  v_n    := COALESCE(p_parcelas, 0);
  IF v_band IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','bandeira_obrigatoria'); END IF;
  IF v_mod NOT IN ('debito','credito') THEN RETURN jsonb_build_object('ok', false, 'erro','modalidade_obrigatoria'); END IF;
  IF v_n < 1 OR v_n > 24 OR (v_mod = 'debito' AND v_n <> 1) THEN
    RETURN jsonb_build_object('ok', false, 'erro','parcelas_invalidas'); END IF;
  IF p_adquirente_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','adquirente_obrigatoria'); END IF;

  SELECT * INTO r FROM erp_receber WHERE id=p_receber_id AND company_id=p_company_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro','conta_nao_encontrada'); END IF;
  IF COALESCE(r.eh_repasse_cartao,false) THEN RETURN jsonb_build_object('ok', false, 'erro','ja_e_repasse'); END IF;
  IF COALESCE(r.valor_pago,0) > 0 OR lower(COALESCE(r.status,'')) IN ('pago','cancelado','renegociado') THEN
    RETURN jsonb_build_object('ok', false, 'erro','titulo_ja_baixado'); END IF;

  v_total := round(COALESCE(r.valor,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0), 2);
  IF v_total <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro','valor_invalido'); END IF;

  calc := fn_cartao_calcular(p_company_id, p_adquirente_id, v_band, v_mod, v_n, v_total, v_data);
  IF NOT (calc->>'ok')::boolean THEN RETURN calc; END IF;
  v_pct   := (calc->>'taxa_percentual')::numeric;
  v_prazo := (calc->>'prazo_repasse_dias')::int;
  SELECT nome INTO v_adq FROM erp_cartao_adquirente WHERE id=p_adquirente_id AND company_id=p_company_id;
  IF v_adq IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','adquirente_nao_encontrada'); END IF;

  -- cliente quitado pela venda no cartão: a baixa é a fonte (o gatilho soma valor_pago e põe o status);
  -- sem conta bancária → não entra no saldo no dia da venda (o dinheiro entra no repasse)
  INSERT INTO erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, criado_por, observacao)
  VALUES (p_receber_id, p_company_id, v_total, v_data, 'cartao_'||v_mod, 'manual', auth.uid(),
          'Recebido em cartão ('||v_adq||' · '||v_band||' · '||v_mod||' '||v_n||'x). O dinheiro entra no repasse da operadora.');
  UPDATE erp_receber SET forma_pagamento = 'cartao_'||v_mod, data_pagamento = v_data, origem_baixa = 'manual',
         baixado_por = COALESCE(baixado_por, auth.uid()), adquirente_id = p_adquirente_id, bandeira = v_band,
         modalidade_cartao = v_mod, cartao_parcelas = v_n, updated_at = now()
   WHERE id = p_receber_id;

  FOR i IN 1..v_n LOOP
    v_bruto := CASE WHEN i < v_n THEN round(v_total / v_n, 2) ELSE round(v_total - v_acum, 2) END;
    v_acum  := v_acum + v_bruto;
    v_taxa  := round(v_bruto * v_pct / 100, 2);
    v_liq   := round(v_bruto - v_taxa, 2);
    v_repasse := v_data + v_prazo + 30 * (i - 1);

    -- título da operadora: valor = BRUTO, desconto = TAXA → a receber (valor − desconto) = LÍQUIDO.
    -- Sem conta a pagar de taxa e sem taxa_pagar_id (a taxa já é o desconto do próprio título).
    INSERT INTO erp_receber (company_id, cliente_nome, descricao, valor, desconto, data_emissao, data_vencimento,
       data_competencia, status, forma_pagamento, categoria, linha_negocio, centro_custo_id,
       eh_repasse_cartao, origem_recebivel_id, adquirente_id, bandeira, modalidade_cartao, cartao_parcelas,
       taxa_percentual, valor_taxa, valor_liquido, data_repasse, ref_externa_sistema, ref_externa_id)
    VALUES (p_company_id, v_adq,
       'Repasse cartão · '||COALESCE(r.cliente_nome,'venda')||' · '||v_band||'/'||v_mod||' · parcela '||i||'/'||v_n,
       v_bruto, v_taxa, v_data, v_repasse, COALESCE(r.data_competencia, v_data), 'aberto', 'repasse_cartao', 'Recebível de cartão',
       r.linha_negocio, r.centro_custo_id, true, p_receber_id, p_adquirente_id, v_band, v_mod, v_n,
       v_pct, v_taxa, v_liq, v_repasse, 'repasse_cartao', p_receber_id::text||'#'||i)
    RETURNING id INTO v_novo;

    -- não há mais conta a pagar de taxa: a taxa é o desconto do título de repasse
    v_taxa_pagar := NULL;

    v_parcelas := v_parcelas || jsonb_build_object('parcela', i, 'id', v_novo, 'valor_bruto', v_bruto, 'valor_taxa', v_taxa,
                    'valor_liquido', v_liq, 'data_repasse', v_repasse, 'taxa_pagar_id', v_taxa_pagar);
  END LOOP;

  RETURN jsonb_build_object('ok', true,
    'cliente_baixado', jsonb_build_object('receber_id', p_receber_id, 'valor', v_total),
    'adquirente', v_adq, 'taxa_percentual', v_pct, 'parcelas', v_parcelas,
    'total_taxa', (SELECT COALESCE(sum((p->>'valor_taxa')::numeric),0) FROM jsonb_array_elements(v_parcelas) p),
    'total_liquido', (SELECT COALESCE(sum((p->>'valor_liquido')::numeric),0) FROM jsonb_array_elements(v_parcelas) p));
END $function$;

REVOKE ALL ON FUNCTION public.fn_cartao_registrar_recebimento(uuid, uuid, uuid, text, text, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cartao_registrar_recebimento(uuid, uuid, uuid, text, text, integer, date) TO authenticated;

-- 2) conciliação agrupada: baixar o repasse pelo LÍQUIDO (valor − desconto) -------------------------------------------
-- (antes baixava pelo bruto e quitava a taxa_pagar; os NOVOS títulos não têm taxa_pagar, a taxa já é o desconto.
--  A quitação de taxa_pagar permanece para os títulos ANTIGOS que ainda a possuem.)
CREATE OR REPLACE FUNCTION public.fn_cartao_conciliar_repasse(p_company_id uuid, p_recebivel_ids uuid[], p_data_recebimento date, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_movimento_banco_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_qtd int; v_total numeric; v_taxas int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  UPDATE erp_receber SET status='recebido', valor_pago=round(valor - COALESCE(desconto,0), 2), data_pagamento=p_data_recebimento,
     conta_bancaria_id=COALESCE(p_conta_bancaria_id,conta_bancaria_id),
     movimento_banco_id=COALESCE(p_movimento_banco_id,movimento_banco_id), conciliado=true, updated_at=now()
   WHERE id = ANY(p_recebivel_ids) AND company_id=p_company_id AND eh_repasse_cartao AND status IN ('aberto','vencido');
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  SELECT COALESCE(sum(valor - COALESCE(desconto,0)),0) INTO v_total FROM erp_receber
   WHERE id = ANY(p_recebivel_ids) AND company_id=p_company_id AND eh_repasse_cartao;

  UPDATE erp_pagar SET status='pago', valor_pago=valor, data_pagamento=p_data_recebimento, updated_at=now()
   WHERE id IN (SELECT taxa_pagar_id FROM erp_receber WHERE id = ANY(p_recebivel_ids) AND taxa_pagar_id IS NOT NULL)
     AND company_id=p_company_id AND status<>'pago';
  GET DIAGNOSTICS v_taxas = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'recebiveis_baixados', v_qtd, 'total_liquido', round(v_total,2), 'taxas_quitadas', v_taxas);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cartao_conciliar_repasse(uuid, uuid[], date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cartao_conciliar_repasse(uuid, uuid[], date, uuid, uuid) TO authenticated;
