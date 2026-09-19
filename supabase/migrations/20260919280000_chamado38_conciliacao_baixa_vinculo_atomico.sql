-- Chamado #38 (Gean · a462e13f) — conciliação: baixa feita SEM vínculo → risco de baixa em duplicidade
--
-- CAUSA (provada no dado, RD-38): a baixa do título é recomputada por fn_recompute_baixa_titulo a partir
-- de SUM(conciliacao_movimento.valor WHERE status='conciliado') — a fonte é o MOVIMENTO, não o vínculo.
-- Mas fn_conciliacao_aplicar_match marca o movimento como 'conciliado' (→ trigger baixa o título) SEM
-- criar a linha em conciliacao_vinculo. Só fn_conciliacao_vincular cria o vínculo; a auto-conciliação
-- (fn_conciliacao_rodar_lote → aplicar_match) e o "aplicar sugestão" não criam. Resultado: 562 movimentos
-- conciliados (título baixado) sem vínculo em produção (Gean: 100). Na tela some o vínculo e, pior, as
-- duas travas anti-duplicidade divergem (uma lê o movimento, a outra o vínculo) → risco de baixa dupla.
--
-- CORREÇÃO: aplicar_match passa a fazer UPSERT do conciliacao_vinculo na MESMA transação em que marca
-- o movimento conciliado (baixa ⟺ vínculo atômico). Assim todo título baixado por conciliação tem vínculo,
-- a tela mostra o elo, e as duas travas anti-duplicidade voltam a concordar. + BACKFILL dos órfãos.

-- ── Correção da função ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
-- OUT column "movimento_id" (RETURNS TABLE) colide com a coluna conciliacao_vinculo.movimento_id no
-- INSERT abaixo → "column reference is ambiguous". use_column faz o plpgsql preferir a COLUNA no INSERT.
#variable_conflict use_column
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

  -- #38: baixa ⟺ vínculo ATÔMICO. O UPDATE acima já dispara a baixa (trigger → recompute a partir do
  -- movimento). Aqui garantimos que o VÍNCULO exista SEMPRE que o título é baixado por conciliação —
  -- inclusive na auto-conciliação/aplicar-sugestão, que antes baixava sem gerar vínculo (órfão).
  -- Idempotente: quando fn_conciliacao_vincular já inseriu o vínculo, o ON CONFLICT só reafirma o valor.
  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_mov.company_id, p_lancamento_tabela, p_lancamento_id, round(abs(v_mov.valor),2), p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE SET valor_vinculado = EXCLUDED.valor_vinculado;

  -- carimbo "Conciliado" (o trigger de baixa já rodou no UPDATE acima; aqui só marca o booleano derivado)
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

-- ── Backfill: varrer órfãos (movimento conciliado sem vínculo → materializa o elo faltante) ──────────
-- Não muda a baixa (que já veio do movimento); só materializa o conciliacao_vinculo ausente, deixando as
-- duas travas anti-duplicidade coerentes e a tela mostrando o elo. criado_por NULL = reparo automático.
INSERT INTO public.conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
SELECT m.id, m.company_id, m.lancamento_tabela, m.lancamento_id, round(abs(m.valor),2), NULL
FROM public.conciliacao_movimento m
WHERE m.status = 'conciliado' AND m.lancamento_id IS NOT NULL AND m.lancamento_tabela IN ('erp_receber','erp_pagar')
  AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO NOTHING;
