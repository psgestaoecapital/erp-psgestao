-- Puxador de extrato bancario direto (Sicoob → futuros bancos).
-- Variante sistema do fn_conciliacao_criar_lote: nao exige auth.uid(),
-- e chamada pela rota /api/banco/extrato/sync (cron ou botao).
-- Idempotente por id_externo — 2x nao duplica.
-- Aplicada via MCP em 2026-07-01.

CREATE OR REPLACE FUNCTION public.fn_extrato_importar_sistema(
  p_company_id         uuid,
  p_conta_bancaria_id  uuid,
  p_provider           text,
  p_movimentos         jsonb,
  p_periodo_inicio     date,
  p_periodo_fim        date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote_id uuid;
  v_mov     jsonb;
  v_id_ext  text;
  v_inseridos integer := 0;
  v_ignorados integer := 0;
  v_soma    numeric := 0;
  v_ja_existia boolean;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'company_id_ausente');
  END IF;
  IF p_movimentos IS NULL OR jsonb_typeof(p_movimentos) <> 'array' THEN
    p_movimentos := '[]'::jsonb;
  END IF;

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

  FOR v_mov IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    v_id_ext := NULLIF(v_mov->>'id_externo', '');
    IF v_id_ext IS NULL THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM conciliacao_movimento
      WHERE company_id = p_company_id AND id_externo = v_id_ext
    ) INTO v_ja_existia;

    IF v_ja_existia THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    INSERT INTO conciliacao_movimento
      (lote_id, company_id, data_transacao, valor, descricao,
       natureza, id_externo, documento, status)
    VALUES
      (v_lote_id, p_company_id,
       (v_mov->>'data_transacao')::date,
       COALESCE((v_mov->>'valor')::numeric, 0),
       COALESCE(v_mov->>'descricao', ''),
       CASE lower(COALESCE(v_mov->>'natureza','')) WHEN 'credito' THEN 'credito'
                                                  WHEN 'debito'  THEN 'debito'
                                                  ELSE 'credito' END,
       v_id_ext,
       NULLIF(v_mov->>'documento', ''),
       'pendente');
    v_inseridos := v_inseridos + 1;
    v_soma := v_soma + COALESCE((v_mov->>'valor')::numeric, 0);
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
    'ignorados_duplicados', v_ignorados
  );
END $$;

GRANT EXECUTE ON FUNCTION public.fn_extrato_importar_sistema(uuid, uuid, text, jsonb, date, date)
  TO service_role, authenticated;

CREATE INDEX IF NOT EXISTS idx_conciliacao_movimento_company_id_externo
  ON public.conciliacao_movimento (company_id, id_externo)
  WHERE id_externo IS NOT NULL;
