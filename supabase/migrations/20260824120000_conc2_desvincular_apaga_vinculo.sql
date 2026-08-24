-- CONC-2 · Desfazer conciliação deixava vínculo órfão (KGF · BONNO). RD-38 (auditado):
-- fn_conciliacao_desvincular reseta conciliacao_movimento->pendente e marca o título
-- conciliado=false/movimento_banco_id=NULL, MAS nunca apagava conciliacao_vinculo — as irmãs
-- fn_conciliacao_desvincular_item e _movimento já apagam; só esta esquecia. Resultado: 90 vínculos
-- órfãos (50 receber + 40 pagar, 4 empresas) e a tela seguia lendo o título como "conciliado"
-- (sem deixar refazer). Fix da RAIZ: apagar o vínculo no desfazer.
--
-- Guard multi-tenant idêntico ao já usado (company_id IN get_user_company_ids()). Sem regressão nas
-- irmãs (que continuam apagando). Também torna o desfazer IDEMPOTENTE: se o movimento já estava
-- resetado mas o vínculo era resíduo (exatamente o estado órfão), um novo "desfazer" limpa o vínculo
-- e retorna sucesso em vez de 'nenhum_movimento_encontrado' — auto-cura o caso do usuário no retry.

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
  v_vin_count int := 0;
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

  -- CONC-2 (RAIZ): apaga o vínculo — sem isso ele fica órfão e a tela mantém o título "conciliado".
  DELETE FROM public.conciliacao_vinculo
   WHERE lancamento_id = p_lancamento_id
     AND lancamento_tabela = v_tabela
     AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_vin_count = ROW_COUNT;

  -- Só falha se NADA foi desfeito (nem movimento resetado, nem vínculo removido).
  IF v_mov_count = 0 AND v_vin_count = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  RETURN jsonb_build_object('sucesso', true,
                            'movimentos_resetados', v_mov_count,
                            'vinculos_removidos', v_vin_count,
                            'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
END
$function$;
