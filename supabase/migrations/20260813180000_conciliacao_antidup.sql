-- RD-41 · Conciliação: PARAR A SANGRIA da duplicação (PDois/Proplay · reportado pela Julia).
-- Causa auditada: o extrato Cresol/Prigol repete o mesmo lançamento com FITID vazio/diferente → nascem 2
-- movimentos idênticos; conciliar a cópia gera um 2º vínculo no mesmo título = baixa dobrada.
-- (Confirmado no banco: título 25,00 com 3 vínculos somando 75,00.)
--
-- FIX A — dedup por CONTEÚDO no import (não só FITID), inclusive dentro do mesmo lote.
-- FIX B — trava contra sobre-vínculo: um título nunca recebe vínculos/baixa além do seu valor líquido.
-- NÃO limpa os grupos já existentes (passo à parte, com backup + conferência da Julia).

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- FIX A · índice de apoio + reescrita do dedup no import (fn_conciliacao_criar_lote)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_concil_mov_dedup
  ON public.conciliacao_movimento (company_id, data_transacao, valor, descricao_normalizada);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_criar_lote(p_company_id uuid, p_tipo text, p_origem text, p_nome text, p_arquivo_nome text, p_arquivo_hash text, p_storage_path text, p_movimentos jsonb, p_periodo_inicio date DEFAULT NULL::date, p_periodo_fim date DEFAULT NULL::date, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_cartao_id uuid DEFAULT NULL::uuid, p_operadora text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid; v_user_id uuid := auth.uid();
  v_recebidos int := 0; v_novos int := 0; v_ignorados int := 0;
  v_total_valor numeric := 0;
  v_existing_lote_id uuid; v_movimento jsonb;
  v_min_data date; v_max_data date; v_tipo_norm text;
  v_fitid text; v_data date; v_valor numeric; v_desc text; v_desc_norm text;
  v_dup boolean;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id obrigatorio'; END IF;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;

  v_tipo_norm := CASE lower(COALESCE(p_tipo,''))
    WHEN 'bancario' THEN 'bancario' WHEN 'extrato_bancario' THEN 'bancario'
    WHEN 'cartao_despesa' THEN 'cartao_despesa' WHEN 'fatura_cartao' THEN 'cartao_despesa'
    WHEN 'cartao_venda' THEN 'cartao_venda' WHEN 'outro' THEN 'outro' ELSE NULL END;
  IF v_tipo_norm IS NULL THEN RAISE EXCEPTION 'tipo invalido: %', p_tipo; END IF;

  IF p_movimentos IS NULL OR jsonb_array_length(p_movimentos) = 0 THEN
    RAISE EXCEPTION 'movimentos vazios - parse OFX falhou'; END IF;

  IF NOT EXISTS(SELECT 1 FROM user_companies WHERE user_id = v_user_id AND company_id = p_company_id)
     AND NOT is_admin() THEN RAISE EXCEPTION 'Sem permissao para essa empresa'; END IF;

  -- Guard 1: arquivo idêntico (hash)
  IF p_arquivo_hash IS NOT NULL THEN
    SELECT id INTO v_existing_lote_id FROM conciliacao_lote
    WHERE company_id = p_company_id AND arquivo_hash = p_arquivo_hash AND status <> 'cancelado' LIMIT 1;
    IF v_existing_lote_id IS NOT NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'arquivo_duplicado',
        'mensagem', 'Esse arquivo já foi importado antes.', 'lote_existente_id', v_existing_lote_id);
    END IF;
  END IF;

  IF p_periodo_inicio IS NULL OR p_periodo_fim IS NULL THEN
    SELECT MIN((m->>'data_transacao')::date), MAX((m->>'data_transacao')::date)
    INTO v_min_data, v_max_data FROM jsonb_array_elements(p_movimentos) m;
  END IF;

  INSERT INTO conciliacao_lote (company_id, tipo, origem, nome, arquivo_nome, arquivo_hash,
    importado_por, periodo_inicio, periodo_fim, conta_bancaria_id, cartao_id, operadora, status)
  VALUES (p_company_id, v_tipo_norm, p_origem, p_nome, p_arquivo_nome, p_arquivo_hash,
    v_user_id, COALESCE(p_periodo_inicio, v_min_data), COALESCE(p_periodo_fim, v_max_data),
    p_conta_bancaria_id, p_cartao_id, p_operadora, 'em_andamento')
  RETURNING id INTO v_lote_id;

  FOR v_movimento IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_recebidos := v_recebidos + 1;
    v_fitid := NULLIF(btrim(v_movimento->>'id_externo'), '');
    v_data  := (v_movimento->>'data_transacao')::date;
    v_valor := (v_movimento->>'valor')::numeric;
    v_desc  := btrim(v_movimento->>'descricao');
    v_desc_norm := fn_normalizar_texto_alerta(v_desc);

    -- Dedup unificado (FIX A): pula se já existe o MESMO FITID (não-vazio) OU o MESMO CONTEÚDO
    -- (data + valor + descrição normalizada) na mesma conta/cartão — INCLUSIVE dentro deste mesmo lote
    -- (o extrato repete a linha no próprio arquivo). RD-51: conteúdo igual só é duplicado quando NÃO há
    -- dois FITIDs distintos não-vazios (se o banco deu FITID distinto, são transações diferentes → mantém).
    SELECT EXISTS (
      SELECT 1 FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
      WHERE cm.company_id = p_company_id
        AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
        AND l.cartao_id IS NOT DISTINCT FROM p_cartao_id
        AND l.status <> 'cancelado'
        AND (
              (v_fitid IS NOT NULL AND NULLIF(btrim(cm.id_externo),'') = v_fitid)
           OR (
                cm.data_transacao = v_data
                AND round(cm.valor,2) = round(v_valor,2)
                AND cm.descricao_normalizada = v_desc_norm
                AND NOT ( v_fitid IS NOT NULL
                          AND NULLIF(btrim(cm.id_externo),'') IS NOT NULL
                          AND NULLIF(btrim(cm.id_externo),'') <> v_fitid )
              )
        )
    ) INTO v_dup;

    IF v_dup THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;

    INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao,
      natureza, id_externo, documento, parcela, adq_bandeira, adq_modalidade, status)
    VALUES (v_lote_id, p_company_id, v_data, v_valor, v_desc,
      NULLIF(v_movimento->>'natureza',''), v_fitid,
      v_movimento->>'documento', v_movimento->>'parcela',
      v_movimento->>'adq_bandeira', v_movimento->>'adq_modalidade', 'pendente');
    v_novos := v_novos + 1;
    v_total_valor := v_total_valor + v_valor;
  END LOOP;

  IF v_novos = 0 THEN
    DELETE FROM conciliacao_movimento WHERE lote_id = v_lote_id;
    DELETE FROM conciliacao_lote WHERE id = v_lote_id;
    RETURN jsonb_build_object('sucesso', true, 'lote_id', NULL,
      'total_recebidos', v_recebidos, 'importados_novos', 0, 'ignorados_duplicados', v_ignorados,
      'total_valor', 0,
      'mensagem', format('Nenhum lançamento novo. Todos os %s já existiam no sistema (ignorados, sem duplicar).', v_recebidos));
  END IF;

  UPDATE conciliacao_lote SET total_movimentos = v_novos, total_valor = v_total_valor,
    total_pendentes = v_novos, total_ignorados = v_ignorados WHERE id = v_lote_id;

  RETURN jsonb_build_object('sucesso', true, 'lote_id', v_lote_id, 'tipo', v_tipo_norm,
    'total_recebidos', v_recebidos, 'importados_novos', v_novos, 'ignorados_duplicados', v_ignorados,
    'total_valor', v_total_valor,
    'periodo_inicio', COALESCE(p_periodo_inicio, v_min_data), 'periodo_fim', COALESCE(p_periodo_fim, v_max_data),
    'mensagem', CASE WHEN v_ignorados > 0
      THEN format('%s novos importados. %s já existiam e foram ignorados (sem duplicar).', v_novos, v_ignorados)
      ELSE format('%s lançamentos importados.', v_novos) END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM, 'detalhe', SQLSTATE);
END; $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- FIX B · trava contra sobre-vínculo no caminho de vínculo (fn_conciliacao_vincular)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_vincular(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_valor numeric DEFAULT NULL::numeric, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- FIX: default = valor do MOVIMENTO limitado ao saldo do título (não o total do título)
  IF p_valor IS NULL THEN
    v_valor := LEAST(round(abs(v_mov.valor),2), GREATEST(v_saldo,0));
  ELSE
    v_valor := round(p_valor,2);
  END IF;
  IF v_valor <= 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','valor deve ser positivo (saldo do título esgotado?)'); END IF;

  -- FIX B (RD-52/RD-57): um título nunca recebe vínculos além do seu valor líquido. Soma os vínculos
  -- de OUTROS movimentos neste título (o próprio movimento pode reajustar via ON CONFLICT) + o novo valor.
  -- Se ultrapassar → recusa com mensagem clara e NÃO cria o vínculo (mata a baixa dobrada na raiz).
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

  -- CANÔNICO 1:1 — movimento totalmente alocado num ÚNICO título:
  IF v_fecha AND v_qtd = 1 AND v_mov.status IN ('pendente','divergente') THEN
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, p_lancamento_tabela, p_lancamento_id,
             p_operador_id, 'vinculo', 'Conciliado por vínculo manual') t;

    IF p_lancamento_tabela = 'erp_pagar' THEN
      UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        WHERE id = p_lancamento_id;
    ELSE
      UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        WHERE id = p_lancamento_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_vinculado', v_valor,
    'valor_movimento', abs(v_mov.valor),
    'soma_vinculada', v_soma,
    'saldo_movimento', round(abs(v_mov.valor) - v_soma, 2),
    'qtd_vinculos', v_qtd,
    'fecha', v_fecha,
    'conciliado_1x1', (v_fecha AND v_qtd = 1),
    'split_pendente_fase2', (v_soma < abs(v_mov.valor) - 0.05),
    'match', v_match
  );
END; $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- FIX B (rede) · trava no chokepoint que marca 'conciliado' (fn_conciliacao_aplicar_match) — cobre o
-- caminho automático/direto que não passa por conciliacao_vinculo (a baixa vem da soma dos movimentos
-- conciliados no título, via fn_recompute_baixa_titulo). RD-57: todos os caminhos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
DECLARE v_mov RECORD; v_score numeric; v_ja numeric; v_liq numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;

  -- FIX B (RD-52/RD-57): não deixa a soma dos movimentos conciliados ultrapassar o título líquido.
  SELECT COALESCE(SUM(valor),0) INTO v_ja FROM public.conciliacao_movimento
    WHERE lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id
      AND status = 'conciliado' AND id <> p_movimento_id;
  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_pagar WHERE id = p_lancamento_id;
  ELSIF p_lancamento_tabela = 'erp_receber' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_receber WHERE id = p_lancamento_id;
  END IF;
  IF v_liq IS NOT NULL AND round(v_ja + v_mov.valor, 2) > v_liq + 0.01 THEN
    RETURN QUERY SELECT p_movimento_id, 'erro',
      'Este título já foi conciliado (valor já coberto). Não vou duplicar a baixa.'::text;
    RETURN;
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
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Match de baixa confiança (score '||COALESCE(v_score,0)::text||'). Informe o motivo para confirmar.';
    RETURN;
  END IF;
  UPDATE conciliacao_movimento
     SET lancamento_tabela = p_lancamento_tabela, lancamento_id = p_lancamento_id,
         match_score = v_score, match_origem = p_origem, match_aplicado_em = now(),
         match_aplicado_por = p_operador_id, status = 'conciliado',
         obs = CASE WHEN COALESCE(btrim(p_motivo),'')<>'' THEN left('[match '||COALESCE(v_score,0)::text||'] '||p_motivo, 500) ELSE obs END,
         updated_at = now()
   WHERE id = p_movimento_id;
  IF length(v_mov.descricao_normalizada) >= 5 THEN
    INSERT INTO conciliacao_regra (company_id, tipo_lote, padrao_descricao, padrao_tipo, sugestao_psgc, origem, hits_total, hits_aceitos, ultima_aplicacao)
    SELECT v_mov.company_id, cl.tipo, substring(v_mov.descricao_normalizada FROM 1 FOR LEAST(30, length(v_mov.descricao_normalizada))),
           'substring', v_mov.psgc_sugestao, 'aprendido', 1, 1, now()
    FROM conciliacao_lote cl WHERE cl.id = v_mov.lote_id
    ON CONFLICT (company_id, tipo_lote, padrao_descricao) DO UPDATE
      SET hits_total = conciliacao_regra.hits_total + 1, hits_aceitos = conciliacao_regra.hits_aceitos + 1, ultima_aplicacao = now(), updated_at = now();
  END IF;
  RETURN QUERY SELECT p_movimento_id, 'conciliado', 'Match aplicado com score ' || v_score::text;
END;
$function$;
