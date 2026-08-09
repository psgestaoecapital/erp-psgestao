-- =============================================================
-- fix_importador_ofx_tipo_bancario_v1 · fn_conciliacao_criar_lote
-- =============================================================
-- Sintoma: importar OFX na inbox falhava com "tipo invalido bancario".
--
-- Causa: a RPC tinha validacao mais restrita que a tabela.
-- Aceitava so 'extrato_bancario'|'fatura_cartao'|'cartao_despesa',
-- mas o frontend (e os lotes ja existentes em prod) usam 'bancario'.
-- A tabela conciliacao_lote NAO tem CHECK constraint em tipo · ou seja,
-- aceitaria qualquer valor; a RPC eh que estava bloqueando.
--
-- Fix: aceitar o vocabulario do frontend + retrocompat com nomes antigos.
-- Normaliza p_tipo:
--   bancario        | extrato_bancario  -> 'bancario'
--   cartao_despesa  | fatura_cartao     -> 'cartao_despesa'
--   cartao_venda                        -> 'cartao_venda'
--   outro                               -> 'outro'
-- Retorno jsonb ganhou campo 'tipo' (normalizado).
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_criar_lote(p_company_id uuid, p_tipo text, p_origem text, p_nome text, p_arquivo_nome text, p_arquivo_hash text, p_storage_path text, p_movimentos jsonb, p_periodo_inicio date DEFAULT NULL::date, p_periodo_fim date DEFAULT NULL::date, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_cartao_id uuid DEFAULT NULL::uuid, p_operadora text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid;
  v_user_id uuid := auth.uid();
  v_count int := 0;
  v_total_valor numeric := 0;
  v_existing_lote_id uuid;
  v_movimento jsonb;
  v_min_data date;
  v_max_data date;
  v_tipo_norm text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  v_tipo_norm := CASE lower(COALESCE(p_tipo,''))
    WHEN 'bancario'         THEN 'bancario'
    WHEN 'extrato_bancario' THEN 'bancario'
    WHEN 'cartao_despesa'   THEN 'cartao_despesa'
    WHEN 'fatura_cartao'    THEN 'cartao_despesa'
    WHEN 'cartao_venda'     THEN 'cartao_venda'
    WHEN 'outro'            THEN 'outro'
    ELSE NULL
  END;

  IF v_tipo_norm IS NULL THEN
    RAISE EXCEPTION 'tipo invalido: %', p_tipo;
  END IF;

  IF p_movimentos IS NULL OR jsonb_array_length(p_movimentos) = 0 THEN
    RAISE EXCEPTION 'movimentos vazios - parse OFX falhou';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM user_companies
    WHERE user_id = v_user_id
      AND company_id = p_company_id
  ) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Sem permissao para essa empresa';
  END IF;

  IF p_arquivo_hash IS NOT NULL THEN
    SELECT id INTO v_existing_lote_id
    FROM conciliacao_lote
    WHERE company_id = p_company_id
      AND arquivo_hash = p_arquivo_hash
      AND status != 'cancelado'
    LIMIT 1;

    IF v_existing_lote_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sucesso', false,
        'erro', 'arquivo_duplicado',
        'mensagem', 'Esse arquivo ja foi importado antes. Lote existente: ' || v_existing_lote_id::text,
        'lote_existente_id', v_existing_lote_id
      );
    END IF;
  END IF;

  IF p_periodo_inicio IS NULL OR p_periodo_fim IS NULL THEN
    SELECT
      MIN((m->>'data_transacao')::date),
      MAX((m->>'data_transacao')::date)
    INTO v_min_data, v_max_data
    FROM jsonb_array_elements(p_movimentos) m;
  END IF;

  INSERT INTO conciliacao_lote (
    company_id, tipo, origem, nome, arquivo_nome, arquivo_hash,
    importado_por, periodo_inicio, periodo_fim,
    conta_bancaria_id, cartao_id, operadora, status
  )
  VALUES (
    p_company_id, v_tipo_norm, p_origem, p_nome, p_arquivo_nome, p_arquivo_hash,
    v_user_id,
    COALESCE(p_periodo_inicio, v_min_data),
    COALESCE(p_periodo_fim, v_max_data),
    p_conta_bancaria_id, p_cartao_id, p_operadora,
    'em_andamento'
  )
  RETURNING id INTO v_lote_id;

  FOR v_movimento IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    INSERT INTO conciliacao_movimento (
      lote_id, company_id, data_transacao, valor, descricao,
      natureza, id_externo, documento, parcela,
      adq_bandeira, adq_modalidade, status
    )
    VALUES (
      v_lote_id,
      p_company_id,
      (v_movimento->>'data_transacao')::date,
      (v_movimento->>'valor')::numeric,
      v_movimento->>'descricao',
      COALESCE(v_movimento->>'natureza', 'debito'),
      v_movimento->>'id_externo',
      v_movimento->>'documento',
      v_movimento->>'parcela',
      v_movimento->>'adq_bandeira',
      v_movimento->>'adq_modalidade',
      'pendente'
    );

    v_count := v_count + 1;
    v_total_valor := v_total_valor + (v_movimento->>'valor')::numeric;
  END LOOP;

  UPDATE conciliacao_lote
  SET total_movimentos = v_count,
      total_valor = v_total_valor,
      total_pendentes = v_count
  WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'lote_id', v_lote_id,
    'tipo', v_tipo_norm,
    'total_movimentos', v_count,
    'total_valor', v_total_valor,
    'periodo_inicio', COALESCE(p_periodo_inicio, v_min_data),
    'periodo_fim', COALESCE(p_periodo_fim, v_max_data),
    'mensagem', format('Lote criado com %s movimentos. Conciliacao automatica disponivel.', v_count)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', SQLERRM,
      'detalhe', SQLSTATE
    );
END;
$function$;
