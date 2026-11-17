-- #3740 (Jordana · Gean, piloto, vale para TODAS as empresas) — AJUSTE: a taxa de cartão vira DESCONTO no título da
-- administradora, e NÃO mais uma conta a pagar separada.
--
-- Antes: fn_cartao_registrar_recebimento gerava 1 título de repasse por parcela (em nome da operadora) com valor = bruto
-- e, quando havia taxa, criava 1 linha em erp_pagar ("Taxa de cartão · … · despesa financeira") e ligava taxa_pagar_id.
-- O fechamento do repasse (fn_trg_cartao_repasse_fechar) recuperava a taxa como baixa 'taxa_cartao', fechando o título
-- em BRUTO, e marcava a conta a pagar como paga.
--
-- Agora (pedido da Jordana, chamado #3740): cada repasse mantém o valor BRUTO em `valor` e recebe a taxa no campo
-- `desconto`; o valor a receber do repasse é bruto − desconto = líquido. NÃO se cria mais conta a pagar de taxa e os
-- novos repasses nascem com taxa_pagar_id NULL. O fechamento já desconta `desconto` no cálculo do resíduo
-- (v_res = valor + juros + multa − desconto − baixas): com desconto = taxa, o crédito do extrato (líquido) fecha o
-- título sozinho (v_res = 0) e o gatilho vira no-op — sem baixa extra de taxa e sem conta a pagar para quitar.
--
-- Mudança cirúrgica: SÓ a função geradora. O gatilho de fechamento e a conciliação (que leem `desconto`/`valor_liquido`)
-- ficam idênticos. Repasses ANTIGOS não são tocados (o ajuste em lote da Gean é item separado, com backup e lista).
--
-- ADITIVA/idempotente: CREATE OR REPLACE da função; sem alterar dado de cliente; sem DROP/DELETE/UPDATE em massa.
-- Área sensível (financeiro de cliente) → revisão do Engenheiro Chefe.
--
-- OBSERVAÇÃO (dependência registrada ao Eng. Chefe no chamado): a representação no DRE da taxa como "dedução da receita"
-- (o DRE hoje exclui o repasse da receita e lia a taxa pela conta a pagar) é decisão estrutural separada (item 2 do
-- chamado). Esta migration entrega apenas a geração (item 1).

CREATE OR REPLACE FUNCTION public.fn_cartao_registrar_recebimento(p_company_id uuid, p_receber_id uuid, p_adquirente_id uuid, p_bandeira text, p_modalidade text, p_parcelas integer, p_data_venda date DEFAULT CURRENT_DATE)
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

    -- #3740: a taxa entra como DESCONTO do repasse (valor a receber = bruto − desconto = líquido). Sem conta a pagar.
    INSERT INTO erp_receber (company_id, cliente_nome, descricao, valor, data_emissao, data_vencimento,
       data_competencia, status, forma_pagamento, categoria, linha_negocio, centro_custo_id,
       eh_repasse_cartao, origem_recebivel_id, adquirente_id, bandeira, modalidade_cartao, cartao_parcelas,
       desconto, taxa_percentual, valor_taxa, valor_liquido, data_repasse, ref_externa_sistema, ref_externa_id)
    VALUES (p_company_id, v_adq,
       'Repasse cartão · '||COALESCE(r.cliente_nome,'venda')||' · '||v_band||'/'||v_mod||' · parcela '||i||'/'||v_n,
       v_bruto, v_data, v_repasse, COALESCE(r.data_competencia, v_data), 'aberto', 'repasse_cartao', 'Recebível de cartão',
       r.linha_negocio, r.centro_custo_id, true, p_receber_id, p_adquirente_id, v_band, v_mod, v_n,
       v_taxa, v_pct, v_taxa, v_liq, v_repasse, 'repasse_cartao', p_receber_id::text||'#'||i)
    RETURNING id INTO v_novo;

    -- #3740: NÃO se cria mais conta a pagar de taxa de cartão; o repasse já nasce líquido via o desconto.
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
