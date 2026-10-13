-- SPEC 3 · Precisão do motor de conciliação (fecha a torneira). Pré-requisito do Bloco 2 da limpeza.
-- Parte C: dedup do import por CONTEÚDO (não só FITID), com regra segura anti-falso-positivo (RD-51).
-- Parte I: motor de match/sugestão respeita deleted_at (parente do #1005) — fim do título fantasma (print 10).
-- Auditado (RD-38): fn_extrato_importar_sistema dedup só por (company_id, id_externo) e DESCARTA linhas sem
-- FITID; os 52 duplicados têm FITID nulo/diferente → passam. 7 funções candidatas a match são leitura pura
-- (não escrevem erp_pagar/erp_receber) → transform seguro.

-- ══════════════════════════════════════════════════════════════════════════════════════════════════
-- PARTE C — fn_extrato_importar_sistema: dedup por FITID OU conteúdo (quando FITID nulo/diferente).
--   Regra segura (RD-51 — nunca sumir calado):
--   1) FITID exato já existente → ignora (re-run).
--   2) conteúdo (valor + data + descrição normalizada) == um movimento JÁ CONCILIADO → ignora
--      (é o MESMO dinheiro já baixado; é o caso dos 52 dup / 7 com baixa dupla).
--   3) caso contrário IMPORTA; se o conteúdo bate com um PENDENTE existente ou com outra linha do MESMO
--      arquivo (mesmo lote), marca motivo_status='possivel_duplicado' pra a Jordana decidir (não some).
--   Também passa a IMPORTAR linhas sem FITID (antes eram descartadas), sob as mesmas guardas.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_extrato_importar_sistema(p_company_id uuid, p_conta_bancaria_id uuid, p_provider text, p_movimentos jsonb, p_periodo_inicio date, p_periodo_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid;
  v_mov     jsonb;
  v_id_ext  text;
  v_valor   numeric;
  v_data    date;
  v_desc    text;
  v_dnorm   text;
  v_inseridos integer := 0;
  v_ignorados integer := 0;
  v_avisos    integer := 0;
  v_erros     integer := 0;
  v_primeiro_erro text := NULL;
  v_soma    numeric := 0;
  v_possivel boolean;
  v_motivo  text;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'company_id_ausente');
  END IF;
  IF p_movimentos IS NULL OR jsonb_typeof(p_movimentos) <> 'array' THEN
    p_movimentos := '[]'::jsonb;
  END IF;

  -- 1) cria ou reusa lote em_andamento pra este periodo/conta/provider
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

  -- 2) itera; dedup por FITID OU conteúdo, resiliente por linha
  FOR v_mov IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_id_ext := NULLIF(v_mov->>'id_externo', '');
    v_valor  := COALESCE((v_mov->>'valor')::numeric, 0);
    v_desc   := COALESCE(v_mov->>'descricao', '');
    v_dnorm  := lower(btrim(v_desc));
    BEGIN
      v_data := (v_mov->>'data_transacao')::date;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      IF v_primeiro_erro IS NULL THEN v_primeiro_erro := 'data_transacao inválida'; END IF;
      CONTINUE;
    END;

    -- (a) FITID exato já existente → ignora (re-run do mesmo arquivo)
    IF v_id_ext IS NOT NULL AND EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id AND id_externo = v_id_ext) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    -- (b) conteúdo == movimento JÁ CONCILIADO → é o mesmo dinheiro já baixado → ignora (RD-51 seguro)
    IF EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id AND status = 'conciliado'
           AND valor = v_valor AND data_transacao = v_data
           AND lower(btrim(descricao)) = v_dnorm) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    -- (c) importa; sinaliza "possível duplicado" se conteúdo bate com um PENDENTE existente
    --     ou com outra linha do MESMO arquivo (mesmo lote) — nunca descarta calado.
    v_possivel := EXISTS(
         SELECT 1 FROM conciliacao_movimento
         WHERE company_id = p_company_id
           AND valor = v_valor AND data_transacao = v_data
           AND lower(btrim(descricao)) = v_dnorm
           AND (status IN ('pendente', 'ignorado') OR lote_id = v_lote_id));
    v_motivo := CASE WHEN v_possivel THEN 'possivel_duplicado' ELSE NULL END;

    BEGIN
      INSERT INTO conciliacao_movimento
        (lote_id, company_id, data_transacao, valor, descricao, descricao_normalizada,
         natureza, id_externo, documento, status, motivo_status, obs)
      VALUES
        (v_lote_id, p_company_id, v_data, v_valor, v_desc, v_dnorm,
         CASE lower(COALESCE(v_mov->>'natureza','')) WHEN 'credito' THEN 'credito'
                                                    WHEN 'debito'  THEN 'debito'
                                                    ELSE 'credito' END,
         v_id_ext,
         NULLIF(v_mov->>'documento', ''),
         'pendente',
         v_motivo,
         CASE WHEN v_possivel THEN 'Possível duplicado: mesmo valor+data+descrição de outro lançamento — confira antes de conciliar.' ELSE NULL END);
      v_inseridos := v_inseridos + 1;
      v_soma := v_soma + v_valor;
      IF v_possivel THEN v_avisos := v_avisos + 1; END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_ignorados := v_ignorados + 1;   -- id_externo repetido (corrida / re-run)
      WHEN OTHERS THEN
        v_erros := v_erros + 1;
        IF v_primeiro_erro IS NULL THEN v_primeiro_erro := SQLERRM; END IF;
    END;
  END LOOP;

  -- 3) atualiza contadores do lote (apenas o delta que entrou)
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

-- ══════════════════════════════════════════════════════════════════════════════════════════════════
-- PARTE I — match/sugestão respeita deleted_at. Mesmo método do #1005 (Postgres reescreve a definição viva,
-- zero transcrição manual): cada leitura FROM/JOIN erp_pagar/erp_receber vira um subselect filtrado por
-- deleted_at IS NULL. Restrito às 7 funções que OFERECEM/RANQUEIAM candidatos — todas leitura pura
-- (auditado: nenhuma escreve nessas tabelas), então o wrap é seguro.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrate$
DECLARE
  r record; v_def text; v_new text;
  v_names text[] := ARRAY[
    'fn_conciliacao_sugerir_match','fn_ge_conciliacao_sugerir_matches','fn_remessa_retorno_conciliar_auto',
    'buscar_matches_extrato','fn_conciliacao_qtd_candidatos','fn_conciliacao_buscar_lancamentos',
    'fn_conciliacao_pendencias_sistema'];
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_names)
  LOOP
    v_def := pg_get_functiondef(r.oid);
    -- leitura com alias: FROM/JOIN erp_pagar ep  →  FROM/JOIN (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
    v_new := regexp_replace(v_def, '(FROM |JOIN )(erp_receber|erp_pagar)( +)([a-z][a-z0-9_]*)',
                            '\1(SELECT * FROM public.\2 WHERE deleted_at IS NULL) \4', 'g');
    -- leitura sem alias: FROM/JOIN erp_pagar (WHERE/…)  →  … com alias = nome da tabela
    v_new := regexp_replace(v_new, '(FROM |JOIN )(erp_receber|erp_pagar)\y',
                            '\1(SELECT * FROM public.\2 WHERE deleted_at IS NULL) \2', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END $migrate$;
