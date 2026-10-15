-- Conciliação: a dedup por CONTEÚDO cobre os DOIS caminhos (OFX manual e sync por API) — pedido rodrigo-chat 15/10 (#2662).
-- Contexto: a migration 20261015235030 retira os índices únicos por id_externo (o Bradesco reaproveita FITID entre exportações).
-- Esses índices também travavam fn_extrato_importar_sistema (sync por API). Aqui a trava passa a ser por conteúdo nos dois:
--   chave = (company_id, conta/cartão, data_transacao, valor, natureza, descricao_normalizada) com CONTADOR de ocorrência
--   (n no payload × n no banco), então dois PIX iguais no mesmo dia continuam entrando e nenhum lançamento novo é descartado
--   por colisão de id_externo. Além disso, as duas funções serializam por empresa+conta (advisory lock transacional),
--   papel que a unicidade do índice fazia contra dois imports simultâneos.
-- Só funções (CREATE OR REPLACE); nenhum dado é alterado ou apagado.

-- 1) OFX manual: igual à definição viva, + advisory lock (única mudança).
CREATE OR REPLACE FUNCTION public.fn_conciliacao_criar_lote(p_company_id uuid, p_tipo text, p_origem text, p_nome text, p_arquivo_nome text, p_arquivo_hash text, p_storage_path text, p_movimentos jsonb, p_periodo_inicio date DEFAULT NULL::date, p_periodo_fim date DEFAULT NULL::date, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_cartao_id uuid DEFAULT NULL::uuid, p_operadora text DEFAULT NULL::text, p_saldo_fechamento numeric DEFAULT NULL::numeric, p_saldo_data timestamp with time zone DEFAULT NULL::timestamp with time zone, p_saldo_bruto jsonb DEFAULT NULL::jsonb)
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
  v_n_arq int; v_n_banco int;
  v_saldo_res jsonb := NULL;
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

  -- Serializa imports da mesma empresa+conta/cartão (a unicidade por id_externo deixou de fazer esse papel).
  PERFORM pg_advisory_xact_lock(hashtextextended('conc:' || p_company_id::text || ':' || COALESCE(p_conta_bancaria_id::text,'') || ':' || COALESCE(p_cartao_id::text,''), 0));

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

  -- CONC-1: contagem por chave natural (data + valor + descrição normalizada) NESTE arquivo.
  DROP TABLE IF EXISTS _arq_conc;
  CREATE TEMP TABLE _arq_conc ON COMMIT DROP AS
    SELECT (m->>'data_transacao')::date AS d,
           round((m->>'valor')::numeric, 2) AS v,
           fn_normalizar_texto_alerta(btrim(m->>'descricao')) AS dn,
           count(*)::int AS n_arq
    FROM jsonb_array_elements(p_movimentos) m
    GROUP BY 1, 2, 3;

  FOR v_movimento IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_recebidos := v_recebidos + 1;
    v_fitid := NULLIF(btrim(v_movimento->>'id_externo'), '');
    v_data  := (v_movimento->>'data_transacao')::date;
    v_valor := (v_movimento->>'valor')::numeric;
    v_desc  := btrim(v_movimento->>'descricao');
    v_desc_norm := fn_normalizar_texto_alerta(v_desc);

    SELECT n_arq INTO v_n_arq FROM _arq_conc
     WHERE d = v_data AND v = round(v_valor,2) AND dn = v_desc_norm;
    SELECT count(*) INTO v_n_banco
    FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
    WHERE cm.company_id = p_company_id
      AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
      AND l.cartao_id IS NOT DISTINCT FROM p_cartao_id
      AND l.status <> 'cancelado' AND cm.status <> 'ignorado'
      AND cm.data_transacao = v_data
      AND round(cm.valor,2) = round(v_valor,2)
      AND cm.descricao_normalizada = v_desc_norm;

    IF v_n_banco >= COALESCE(v_n_arq, 1) THEN
      v_ignorados := v_ignorados + 1; CONTINUE;
    END IF;

    INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao,
      natureza, id_externo, documento, parcela, adq_bandeira, adq_modalidade, status)
    VALUES (v_lote_id, p_company_id, v_data, v_valor, v_desc,
      NULLIF(v_movimento->>'natureza',''), v_fitid,
      v_movimento->>'documento', v_movimento->>'parcela',
      v_movimento->>'adq_bandeira', v_movimento->>'adq_modalidade', 'pendente');
    v_novos := v_novos + 1;
    v_total_valor := v_total_valor + v_valor;
  END LOOP;

  -- Saldo de fechamento: PONTO ÚNICO de escrita (RD-65), na MESMA transação. Independe de haver
  -- movimentos novos — o snapshot do saldo vale de qualquer forma. fn_banco_saldo_registrar nunca
  -- retrocede (RD-67): leitura mais antiga → gravado=false. A ORIGEM vem do arquivo (LEDGERBAL →
  -- 'ofx'; linha "SALDO ANTERIOR/DO DIA" → 'ofx_saldo_linha'), preservando a rastreabilidade.
  IF p_saldo_fechamento IS NOT NULL AND p_saldo_data IS NOT NULL AND p_conta_bancaria_id IS NOT NULL THEN
    v_saldo_res := fn_banco_saldo_registrar(
      p_conta_bancaria_id, p_saldo_fechamento,
      COALESCE(NULLIF(p_saldo_bruto->>'origem',''), 'ofx'),
      jsonb_build_object('balamt_bruto', p_saldo_bruto->>'balamt_bruto',
                         'dtasof_bruto', p_saldo_bruto->>'dtasof_bruto',
                         'descricao_linha', p_saldo_bruto->>'descricao_linha',
                         'arquivo_nome', p_arquivo_nome),
      p_saldo_data);
  END IF;

  IF v_novos = 0 THEN
    DELETE FROM conciliacao_movimento WHERE lote_id = v_lote_id;
    DELETE FROM conciliacao_lote WHERE id = v_lote_id;
    RETURN jsonb_build_object('sucesso', true, 'lote_id', NULL,
      'total_recebidos', v_recebidos, 'importados_novos', 0, 'ignorados_duplicados', v_ignorados,
      'total_valor', 0, 'saldo', v_saldo_res,
      'mensagem', format('Nenhum lançamento novo. Todos os %s já existiam no sistema (ignorados, sem duplicar).', v_recebidos));
  END IF;

  UPDATE conciliacao_lote SET total_movimentos = v_novos, total_valor = v_total_valor,
    total_pendentes = v_novos, total_ignorados = v_ignorados WHERE id = v_lote_id;

  RETURN jsonb_build_object('sucesso', true, 'lote_id', v_lote_id, 'tipo', v_tipo_norm,
    'total_recebidos', v_recebidos, 'importados_novos', v_novos, 'ignorados_duplicados', v_ignorados,
    'total_valor', v_total_valor, 'saldo', v_saldo_res,
    'periodo_inicio', COALESCE(p_periodo_inicio, v_min_data), 'periodo_fim', COALESCE(p_periodo_fim, v_max_data),
    'mensagem', CASE WHEN v_ignorados > 0
      THEN format('%s novos importados. %s já existiam e foram ignorados (sem duplicar).', v_novos, v_ignorados)
      ELSE format('%s lançamentos importados.', v_novos) END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM, 'detalhe', SQLSTATE);
END; $function$;

-- 2) Sync por API: mesma chave de conteúdo (+ natureza) com contador de ocorrência.
--    id_externo só ignora quando for da MESMA conta e de lote de API (id estável do provedor, cobre descrição que muda
--    ao liquidar); FITID de OFX nunca suprime lançamento. Qualquer status conta como "já existente" (inclusive ignorado
--    pelo usuário), para a sync repetida não ressuscitar o que ele descartou.
CREATE OR REPLACE FUNCTION public.fn_extrato_importar_sistema(p_company_id uuid, p_conta_bancaria_id uuid, p_provider text, p_movimentos jsonb, p_periodo_inicio date, p_periodo_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid; v_mov jsonb; v_id_ext text; v_valor numeric; v_data date; v_desc text; v_dnorm text; v_nat text;
  v_inseridos integer := 0; v_ignorados integer := 0; v_avisos integer := 0; v_erros integer := 0;
  v_primeiro_erro text := NULL; v_soma numeric := 0; v_n_arq int; v_n_banco int;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'company_id_ausente');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF p_movimentos IS NULL OR jsonb_typeof(p_movimentos) <> 'array' THEN
    p_movimentos := '[]'::jsonb;
  END IF;

  -- Mesma chave de serialização de fn_conciliacao_criar_lote (empresa + conta, sem cartão).
  PERFORM pg_advisory_xact_lock(hashtextextended('conc:' || p_company_id::text || ':' || COALESCE(p_conta_bancaria_id::text,'') || ':', 0));

  SELECT id INTO v_lote_id
  FROM conciliacao_lote
  WHERE company_id = p_company_id
    AND tipo = 'bancario'
    AND origem = 'api_' || COALESCE(p_provider, 'desconhecido')
    AND conta_bancaria_id = p_conta_bancaria_id
    AND status = 'em_andamento'
    AND periodo_inicio = p_periodo_inicio
    AND periodo_fim = p_periodo_fim
  ORDER BY created_at DESC LIMIT 1;

  IF v_lote_id IS NULL THEN
    INSERT INTO conciliacao_lote
      (company_id, tipo, origem, nome, periodo_inicio, periodo_fim,
       conta_bancaria_id, total_movimentos, total_valor, total_pendentes,
       status, importado_por)
    VALUES
      (p_company_id, 'bancario', 'api_' || p_provider,
       format('%s · Extrato %s–%s', UPPER(p_provider),
              to_char(p_periodo_inicio, 'DD/MM'),
              to_char(p_periodo_fim, 'DD/MM')),
       p_periodo_inicio, p_periodo_fim,
       p_conta_bancaria_id, 0, 0, 0, 'em_andamento', NULL)
    RETURNING id INTO v_lote_id;
  END IF;

  -- Ocorrências de cada chave de conteúdo NESTE payload (ignora linhas de data inválida; elas caem em erro no loop).
  DROP TABLE IF EXISTS _api_conc;
  CREATE TEMP TABLE _api_conc ON COMMIT DROP AS
    SELECT d, v, nat, dn, count(*)::int AS n_arq
    FROM (
      SELECT CASE WHEN (m->>'data_transacao') ~ '^\d{4}-\d{2}-\d{2}' THEN (m->>'data_transacao')::date END AS d,
             round(COALESCE((m->>'valor')::numeric, 0), 2) AS v,
             CASE lower(COALESCE(m->>'natureza','')) WHEN 'debito' THEN 'debito' ELSE 'credito' END AS nat,
             fn_normalizar_texto_alerta(COALESCE(m->>'descricao','')) AS dn
      FROM jsonb_array_elements(p_movimentos) m
    ) x
    WHERE d IS NOT NULL
    GROUP BY d, v, nat, dn;

  FOR v_mov IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_id_ext := NULLIF(v_mov->>'id_externo', '');
    v_valor  := COALESCE((v_mov->>'valor')::numeric, 0);
    v_desc   := COALESCE(v_mov->>'descricao', '');
    v_dnorm  := fn_normalizar_texto_alerta(btrim(v_desc));
    v_nat    := CASE lower(COALESCE(v_mov->>'natureza','')) WHEN 'debito' THEN 'debito' ELSE 'credito' END;
    BEGIN
      v_data := (v_mov->>'data_transacao')::date;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      IF v_primeiro_erro IS NULL THEN v_primeiro_erro := 'data_transacao inválida'; END IF;
      CONTINUE;
    END;

    -- id estável do provedor de API, na mesma conta, em lote de API.
    IF v_id_ext IS NOT NULL AND EXISTS(
         SELECT 1 FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
         WHERE cm.company_id = p_company_id AND cm.id_externo = v_id_ext
           AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
           AND l.origem LIKE 'api\_%' AND l.status <> 'cancelado') THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    SELECT n_arq INTO v_n_arq FROM _api_conc
     WHERE d = v_data AND v = round(v_valor, 2) AND nat = v_nat AND dn = v_dnorm;
    SELECT count(*) INTO v_n_banco
    FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
    WHERE cm.company_id = p_company_id
      AND l.conta_bancaria_id IS NOT DISTINCT FROM p_conta_bancaria_id
      AND l.status <> 'cancelado'
      AND cm.data_transacao = v_data
      AND round(cm.valor, 2) = round(v_valor, 2)
      AND COALESCE(cm.natureza, 'credito') = v_nat
      AND cm.descricao_normalizada = v_dnorm;

    IF v_n_banco >= COALESCE(v_n_arq, 1) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO conciliacao_movimento
        (lote_id, company_id, data_transacao, valor, descricao,
         natureza, id_externo, documento, status)
      VALUES
        (v_lote_id, p_company_id, v_data, v_valor, v_desc,
         v_nat, v_id_ext, NULLIF(v_mov->>'documento', ''), 'pendente');
      v_inseridos := v_inseridos + 1;
      v_soma := v_soma + v_valor;
    EXCEPTION
      WHEN OTHERS THEN
        v_erros := v_erros + 1;
        IF v_primeiro_erro IS NULL THEN v_primeiro_erro := SQLERRM; END IF;
    END;
  END LOOP;

  UPDATE conciliacao_lote
     SET total_movimentos = total_movimentos + v_inseridos,
         total_valor      = total_valor + v_soma,
         total_pendentes  = total_pendentes + v_inseridos,
         updated_at       = now()
   WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'lote_id', v_lote_id,
    'inseridos', v_inseridos,
    'ignorados_duplicados', v_ignorados,
    'possiveis_duplicados', v_avisos,
    'erros', v_erros,
    'primeiro_erro', v_primeiro_erro
  );
END $function$;

-- Guarda de acesso (check_fn_guards): só logado/serviço executa; anon nunca.
REVOKE ALL ON FUNCTION public.fn_conciliacao_criar_lote(uuid, text, text, text, text, text, text, jsonb, date, date, uuid, uuid, text, numeric, timestamp with time zone, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_criar_lote(uuid, text, text, text, text, text, text, jsonb, date, date, uuid, uuid, text, numeric, timestamp with time zone, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_extrato_importar_sistema(uuid, uuid, text, jsonb, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_extrato_importar_sistema(uuid, uuid, text, jsonb, date, date) TO authenticated, service_role;
