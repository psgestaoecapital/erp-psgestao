-- FIX BUG1 (André Salvi 08/07): desvincular conciliação não funcionava.
-- Causa: frontend passava p_tipo="erp_pagar"/"erp_receber" mas a RPC esperava
-- "pagar"/"receber" e retornava {sucesso:false,'tipo_invalido'} SEM erro SQL — o
-- front só checava error (null) e engolia. Hardening: normaliza p_tipo (aceita com
-- ou sem prefixo erp_), adiciona guard multi-tenant (P2) no UPDATE do título, e
-- devolve sucesso:false quando nenhum movimento casa (front passa a surfacar).
-- O movimento volta a 'pendente'; o trigger trg_baixa_por_conciliacao (CENARIO A)
-- só ESTORNA a baixa no desvínculo (não reconcilia de volta) — comportamento correto.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo   text := lower(regexp_replace(coalesce(p_tipo, ''), '^erp_', ''));
  v_tabela text;
  v_mov_count int := 0;
BEGIN
  IF v_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido', 'tipo_recebido', p_tipo);
  END IF;
  v_tabela := 'erp_' || v_tipo;

  -- Reseta o movimento bancário -> pendente (dispara CENARIO A do trigger = estorno da baixa)
  UPDATE public.conciliacao_movimento
     SET status = 'pendente',
         lancamento_tabela = NULL,
         lancamento_id = NULL,
         match_score = NULL,
         match_origem = NULL,
         match_aplicado_em = NULL,
         match_aplicado_por = NULL,
         updated_at = now()
   WHERE lancamento_id = p_lancamento_id
     AND lancamento_tabela = v_tabela
     AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_mov_count = ROW_COUNT;

  -- Reverte o vínculo no título (guard multi-tenant P2)
  IF v_tipo = 'pagar' THEN
    UPDATE public.erp_pagar
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  ELSE
    UPDATE public.erp_receber
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  END IF;

  IF v_mov_count = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'movimentos_resetados', v_mov_count,
                            'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
END
$function$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) TO authenticated;
