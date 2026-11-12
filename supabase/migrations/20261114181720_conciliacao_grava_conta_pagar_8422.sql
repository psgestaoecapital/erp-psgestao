-- #8422 (Troian) — a conciliação NÃO grava a conta bancária no PAGAMENTO.
--
-- CAUSA (RD-38, prova no dado em produção 2026-11-12):
--   fn_conciliacao_aplicar_match, no fecho #3866, passou a gravar a conta no título SÓ no ramo erp_receber
--   (conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta)). O ramo erp_pagar faz o UPDATE de baixa SEM
--   gravar a conta. Resultado: pagamentos conciliados ficam com conta_bancaria vazia e saem do saldo da conta.
--   Troian (d577602d-…): 61 pagamentos conciliados sem conta = R$ 88.058,11 fora do saldo do Bradesco PJ.
--
--   OBS. de esquema: erp_pagar.conta_bancaria é VARCHAR com o NOME da conta (ex.: "BRADESCO PJ"),
--   enquanto erp_receber.conta_bancaria_id é uuid. fn_saldo_gerencial_contas atribui o pagar à conta por
--   lower(btrim(conta_bancaria)) = lower(btrim(erp_banco_contas.nome)). Por isso aqui gravamos o NOME da conta.
--
-- CORREÇÃO (aditiva, só no ramo erp_pagar): resolve o NOME da conta do lote do movimento (erp_banco_contas.nome
--   pelo conciliacao_lote.conta_bancaria_id) e grava em erp_pagar.conta_bancaria quando estiver vazia
--   (COALESCE — nunca sobrescreve conta já informada). Receber mantém o comportamento do #3866, intacto.
--   O backfill dos 161 títulos já conciliados sem conta vai em PR separada (UPDATE em tabela de domínio).
--
-- Code: jordana-code

CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE v_mov RECORD; v_score numeric; v_ja numeric; v_liq numeric; v_conta uuid; v_conta_nome text;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;
  -- #3866/#8422: conta bancária do lote do movimento — uuid (p/ receber) e nome (p/ pagar, coluna varchar).
  SELECT conta_bancaria_id INTO v_conta FROM public.conciliacao_lote WHERE id = v_mov.lote_id;
  SELECT nome INTO v_conta_nome FROM public.erp_banco_contas WHERE id = v_conta;
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
    -- #8422: grava a conta (nome) no pagamento conciliado quando ainda está vazia (não sobrescreve conta informada).
    UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id,
           conta_bancaria = COALESCE(NULLIF(btrim(conta_bancaria),''), v_conta_nome), updated_at = now() WHERE id = p_lancamento_id;
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
