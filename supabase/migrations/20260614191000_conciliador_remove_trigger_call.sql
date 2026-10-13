-- =============================================================
-- ONDA-A-CONCILIADOR-AUTO-v1 · FIX trigger function
-- =============================================================
-- fn_conciliacao_lote_recalc eh TRIGGER function, nao pode ser
-- chamada diretamente via PERFORM/SELECT. Quando chamada, o engine
-- retorna: "trigger functions can only be called as triggers".
--
-- Removida a linha PERFORM fn_conciliacao_lote_recalc() do runner.
-- O trigger ja dispara automatico nos UPDATEs que fn_conciliacao_aplicar_match
-- faz em conciliacao_movimento.
--
-- Run em KGF apos o fix (322 movs): com_sugestao=282, perfeitos=180,
-- auto_conciliados=170, colisao_pulada=10 (anti-colisao atuou em 10
-- disputas, deixou pra tela manual).
--
-- Aplicada via MCP em 2026-06-14.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_rodar_lote(
  p_company_id   uuid,
  p_lote_id      uuid    DEFAULT NULL,
  p_auto_aplicar boolean DEFAULT false,
  p_score_auto   integer DEFAULT 90,
  p_limite       integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_mov RECORD; v_best RECORD;
  v_processados int := 0; v_com_sugestao int := 0;
  v_perfeitos int := 0; v_quase int := 0; v_sem_match int := 0;
  v_auto_conc int := 0; v_colisao_pulada int := 0;
  v_lancs_usados text[] := '{}';
  v_chave text;
BEGIN
  FOR v_mov IN
    SELECT id, lote_id FROM conciliacao_movimento
    WHERE company_id = p_company_id
      AND status IN ('pendente','divergente')
      AND (p_lote_id IS NULL OR lote_id = p_lote_id)
    ORDER BY data_transacao LIMIT p_limite
  LOOP
    v_processados := v_processados + 1;

    SELECT * INTO v_best FROM fn_conciliacao_sugerir_match(v_mov.id, 1)
    ORDER BY match_score DESC LIMIT 1;

    IF v_best.lancamento_id IS NULL THEN
      v_sem_match := v_sem_match + 1; CONTINUE;
    END IF;

    UPDATE conciliacao_movimento
       SET psgc_sugestao  = v_best.lancamento_tabela || ':' || v_best.lancamento_id,
           psgc_confianca = v_best.match_score,
           motivo_status  = v_best.motivo, updated_at = now()
     WHERE id = v_mov.id;
    v_com_sugestao := v_com_sugestao + 1;

    IF v_best.match_score >= 90 THEN v_perfeitos := v_perfeitos + 1;
    ELSIF v_best.match_score >= 60 THEN v_quase := v_quase + 1; END IF;

    IF p_auto_aplicar AND v_best.match_score >= p_score_auto THEN
      v_chave := v_best.lancamento_tabela || ':' || v_best.lancamento_id;
      IF v_chave = ANY(v_lancs_usados)
         OR EXISTS (
           SELECT 1 FROM conciliacao_movimento cm
           WHERE cm.lancamento_id = v_best.lancamento_id
             AND cm.lancamento_tabela = v_best.lancamento_tabela
             AND cm.status = 'conciliado'
         )
      THEN
        v_colisao_pulada := v_colisao_pulada + 1;
      ELSE
        PERFORM fn_conciliacao_aplicar_match(
          v_mov.id, v_best.lancamento_tabela, v_best.lancamento_id, NULL, 'auto');
        v_lancs_usados := array_append(v_lancs_usados, v_chave);
        v_auto_conc := v_auto_conc + 1;
      END IF;
    END IF;
  END LOOP;

  -- fn_conciliacao_lote_recalc eh trigger function · dispara automatico
  -- nos UPDATEs feitos por fn_conciliacao_aplicar_match. Nao chamar aqui.

  RETURN jsonb_build_object(
    'company_id', p_company_id, 'auto_aplicar', p_auto_aplicar,
    'processados', v_processados, 'com_sugestao', v_com_sugestao,
    'perfeitos', v_perfeitos, 'quase', v_quase, 'sem_match', v_sem_match,
    'auto_conciliados', v_auto_conc, 'colisao_pulada', v_colisao_pulada,
    'rodado_em', now()
  );
END;
$$;
