-- Financeiro · exclusão em massa resiliente (pagar E receber). Fronteira GE (Pilar 1/3).
--
-- Bug (André/Jordana): excluir 1 conta → ok; excluir >1 → "erro no sistema".
-- Causa raiz (RD-38): o massa itera e chama o singular, mas SEM isolar cada item. Quando o
-- singular ESTOURA uma exceção (não um erro tratado) em um item do lote, a exceção sobe e
-- derruba a transação inteira → o massa inteiro falha. Por isso 1 item limpo passa e vários,
-- onde algum estoura, quebram tudo.
--
-- Fix: cada item roda num subbloco BEGIN/EXCEPTION (savepoint) — um item que estoura é
-- registrado e o lote SEGUE. Além disso o massa passa a aceitar p_cancelar_baixa (igual ao
-- singular) e devolve contagem clara (excluídos / bloqueados / exceções) — sem erro genérico.

DROP FUNCTION IF EXISTS public.fn_receber_excluir_massa(uuid[]);
CREATE OR REPLACE FUNCTION public.fn_receber_excluir_massa(p_ids uuid[], p_cancelar_baixa boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_bloq int := 0; v_bol int := 0; v_ja int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      v_res := public.fn_receber_excluir(v_id, p_cancelar_baixa);
      IF (v_res->>'sucesso')::boolean IS TRUE AND COALESCE((v_res->>'ja_excluido')::boolean, false) THEN v_ja := v_ja + 1;
      ELSIF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
      ELSIF v_res->>'erro' IN ('bloqueado_conciliado','requer_cancelar_baixa','bloqueado_conciliado_ou_pago') THEN v_bloq := v_bloq + 1;
      ELSIF v_res->>'erro' = 'bloqueado_boleto_ativo' THEN v_bol := v_bol + 1;
      ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- item que ESTOURA não derruba o lote: rollback só deste item (savepoint) e segue.
      v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', 'excecao', 'detalhe', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'excluidos', v_ok, 'ignoradas_pago_conciliado', v_bloq,
    'ignoradas_boleto_ativo', v_bol, 'ja_excluidas', v_ja, 'outras_falhas', jsonb_array_length(v_erros), 'detalhe', v_erros);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_receber_excluir_massa(uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_excluir_massa(uuid[], boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_pagar_excluir_massa(uuid[]);
CREATE OR REPLACE FUNCTION public.fn_pagar_excluir_massa(p_ids uuid[], p_cancelar_baixa boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_bloq int := 0; v_ja int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      v_res := public.fn_pagar_excluir(v_id, p_cancelar_baixa);
      IF (v_res->>'sucesso')::boolean IS TRUE AND COALESCE((v_res->>'ja_excluido')::boolean, false) THEN v_ja := v_ja + 1;
      ELSIF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
      ELSIF v_res->>'erro' IN ('bloqueado_conciliado','requer_cancelar_baixa','bloqueado_conciliado_ou_pago') THEN v_bloq := v_bloq + 1;
      ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', 'excecao', 'detalhe', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'excluidos', v_ok, 'ignoradas_pago_conciliado', v_bloq,
    'ja_excluidas', v_ja, 'outras_falhas', jsonb_array_length(v_erros), 'detalhe', v_erros);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_pagar_excluir_massa(uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_excluir_massa(uuid[], boolean) TO authenticated;
