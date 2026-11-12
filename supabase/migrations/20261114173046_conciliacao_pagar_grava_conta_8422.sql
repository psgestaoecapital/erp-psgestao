-- Chamado #8422 (Troian) + carteira: a conciliação não grava a conta bancária no título A PAGAR.
--
-- Causa (RD-38, provado em 2026-11-12):
--   fn_conciliacao_aplicar_match, no ramo erp_pagar, só marcava conciliado=true e movimento_banco_id,
--   mas NÃO gravava a conta bancária (coluna texto erp_pagar.conta_bancaria). O ramo erp_receber já
--   grava a conta (conta_bancaria_id, desde o #3866); o ramo erp_pagar ficou de fora.
--   Resultado: pagamentos conciliados ficam "sem conta" e não entram no saldo real da conta.
--
--   Prova na produção (conciliado=true AND conta_bancaria IS NULL, resolvível pela conta do lote):
--     Troian (d577602d...): 61 títulos, R$ 88.006,36  (conta BRADESCO PJ, saldo diverge do extrato)
--     b26c19c0...         : 51 títulos, R$ 47.490,63
--     Gean  (a462e13f...) : 40 títulos, R$ 26.534,53
--     Pdois (36b69d77...) :  3 títulos, R$  1.207,57
--     + 3 empresas menores (6 títulos).
--   A conta de cada título é a conta bancária do lote da conciliação
--   (conciliacao_lote.conta_bancaria_id -> erp_banco_contas.nome).
--
-- Esta migration:
--   1) Conserta a função para gravar a conta no ramo erp_pagar daqui pra frente (simétrico ao receber).
--   2) Faz backfill aditivo e idempotente dos títulos já conciliados sem conta, SÓ onde a conta do lote
--      é conhecível, guardando backup antes (erp_pagar_conta_bkp_8422). Não duplica baixa, não mexe em
--      título que já tem conta, não cria/altera valor de título.

-- 1) Correção da função (CREATE OR REPLACE) -----------------------------------------------------------
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
  -- #3866/#8422: conta bancária do lote do movimento, para gravar no título (a receber e a pagar)
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
    -- #8422: grava a conta bancária (nome) no título a pagar, sem sobrescrever uma conta já informada
    UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id,
           conta_bancaria = COALESCE(conta_bancaria, (SELECT nome FROM public.erp_banco_contas WHERE id = v_conta)),
           updated_at = now() WHERE id = p_lancamento_id;
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

-- 2) Backfill aditivo e idempotente dos títulos já conciliados sem conta ------------------------------
CREATE TABLE IF NOT EXISTS public.erp_pagar_conta_bkp_8422 (
  id uuid NOT NULL,
  company_id uuid,
  conta_bancaria_old text,
  conta_bancaria_new text,
  movimento_banco_id uuid,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);

DO $backfill$
DECLARE v_antes bigint; v_depois bigint; v_corrigidos bigint;
BEGIN
  SELECT count(*) INTO v_antes
  FROM public.erp_pagar p
  JOIN public.conciliacao_movimento m ON m.id = p.movimento_banco_id
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
  JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id
  WHERE p.conciliado = true AND p.conta_bancaria IS NULL;

  -- backup só do que será tocado (evita duplicar se a migration rodar de novo)
  INSERT INTO public.erp_pagar_conta_bkp_8422 (id, company_id, conta_bancaria_old, conta_bancaria_new, movimento_banco_id)
  SELECT p.id, p.company_id, p.conta_bancaria, bc.nome, p.movimento_banco_id
  FROM public.erp_pagar p
  JOIN public.conciliacao_movimento m ON m.id = p.movimento_banco_id
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
  JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id
  WHERE p.conciliado = true AND p.conta_bancaria IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_conta_bkp_8422 b WHERE b.id = p.id);

  WITH alvo AS (
    SELECT p.id, bc.nome AS conta
    FROM public.erp_pagar p
    JOIN public.conciliacao_movimento m ON m.id = p.movimento_banco_id
    JOIN public.conciliacao_lote l ON l.id = m.lote_id
    JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id
    WHERE p.conciliado = true AND p.conta_bancaria IS NULL
  )
  UPDATE public.erp_pagar p
     SET conta_bancaria = alvo.conta, updated_at = now()
  FROM alvo WHERE alvo.id = p.id;
  GET DIAGNOSTICS v_corrigidos = ROW_COUNT;

  SELECT count(*) INTO v_depois
  FROM public.erp_pagar p
  JOIN public.conciliacao_movimento m ON m.id = p.movimento_banco_id
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
  JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id
  WHERE p.conciliado = true AND p.conta_bancaria IS NULL;

  RAISE NOTICE '[#8422] backfill conta a pagar: antes=% corrigidos=% restam_resolviveis=%', v_antes, v_corrigidos, v_depois;
END;
$backfill$;
