-- FIX #8 · Conciliação OFX — dedup por transação (para de bloquear por período).
-- fn_conciliacao_criar_lote importa só o que é novo (FITID; fallback data+valor+descrição normalizada),
-- conta novos vs ignorados, remove o lote-fantasma quando 0 novos. fn_conciliacao_lote_antidup perde o
-- bloqueio por período sobreposto (bloco 2) — mantém só o de arquivo idêntico (hash). Aditivo (RD-55).
CREATE OR REPLACE FUNCTION public.fn_conciliacao_criar_lote(
  p_company_id uuid, p_tipo text, p_origem text, p_nome text,
  p_arquivo_nome text, p_arquivo_hash text, p_storage_path text,
  p_movimentos jsonb,
  p_periodo_inicio date DEFAULT NULL, p_periodo_fim date DEFAULT NULL,
  p_conta_bancaria_id uuid DEFAULT NULL, p_cartao_id uuid DEFAULT NULL,
  p_operadora text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
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

    IF v_fitid IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
        WHERE cm.company_id = p_company_id
          AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
          AND l.cartao_id IS NOT DISTINCT FROM p_cartao_id
          AND l.status <> 'cancelado' AND cm.lote_id <> v_lote_id
          AND NULLIF(btrim(cm.id_externo),'') = v_fitid) INTO v_dup;
    ELSE
      SELECT EXISTS (SELECT 1 FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
        WHERE cm.company_id = p_company_id
          AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
          AND l.cartao_id IS NOT DISTINCT FROM p_cartao_id
          AND l.status <> 'cancelado' AND cm.lote_id <> v_lote_id
          AND (cm.id_externo IS NULL OR btrim(cm.id_externo) = '')
          AND cm.data_transacao = v_data AND cm.valor = v_valor
          AND cm.descricao_normalizada = v_desc_norm) INTO v_dup;
    END IF;

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

CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_antidup()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_quando text;
BEGIN
  -- Único guard de lote: arquivo idêntico (hash). A dedup por TRANSAÇÃO é na fn_conciliacao_criar_lote;
  -- o bloqueio por período sobreposto foi REMOVIDO (FIX #8).
  IF NEW.arquivo_hash IS NOT NULL AND btrim(NEW.arquivo_hash) <> '' THEN
    SELECT to_char(min(created_at),'DD/MM/YYYY') INTO v_quando
      FROM public.conciliacao_lote
     WHERE company_id = NEW.company_id AND arquivo_hash = NEW.arquivo_hash AND id <> NEW.id;
    IF v_quando IS NOT NULL THEN
      RAISE EXCEPTION 'Este extrato (arquivo idêntico) já foi importado nesta empresa em %.', v_quando USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
