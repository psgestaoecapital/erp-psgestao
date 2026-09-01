-- NF-e Recebida Bloco 2 · §1 CRÍTICO (HOTFIX) — o item indeciso (entra_estoque IS NULL) BLOQUEIA a conclusão.
-- Bug (RD-51): a cláusula usava COALESCE(entra_estoque,false)=true AND produto_id IS NULL — com NULL,
-- o COALESCE devolve false, o item não bloqueia, a nota conclui e o estoque NÃO se movimenta, em silêncio.
-- Na KGF: 351 de 356 itens estão com entra_estoque NULL. Bloqueio é reversível; estoque corrompido não.
-- Correção: NULL passa a bloquear. Retorno DISTINGUE indeciso (decidir destino) de sem_produto
-- (entra mas falta produto) — a ação da usuária é diferente — e traz uma 'mensagem' LEGÍVEL para a tela.
-- NÃO se faz UPDATE em massa dos nulos: o nulo tem que aparecer e ser resolvido na tela.

CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_concluir(p_nfe_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v erp_nfe_recebidas%ROWTYPE; v_indecisos jsonb; v_sem_produto jsonb;
        v_n_ind int; v_n_sem int; v_msg text; v_est jsonb; v_pag jsonb;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.concluida_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_concluida', true); END IF;

  -- 1) todos os itens resolvidos. NULL (indeciso) BLOQUEIA — o não-decidido não pode se disfarçar de
  -- decidido (RD-51). Distingue os dois casos: indeciso (decidir destino) vs entra-sem-produto (vincular/criar).
  SELECT jsonb_agg(jsonb_build_object('item', numero_item, 'descricao', descricao) ORDER BY numero_item)
    INTO v_indecisos FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id = v.id AND entra_estoque IS NULL;
  SELECT jsonb_agg(jsonb_build_object('item', numero_item, 'descricao', descricao) ORDER BY numero_item)
    INTO v_sem_produto FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id = v.id AND entra_estoque = true AND produto_id IS NULL;
  IF v_indecisos IS NOT NULL OR v_sem_produto IS NOT NULL THEN
    v_n_ind := COALESCE(jsonb_array_length(v_indecisos), 0);
    v_n_sem := COALESCE(jsonb_array_length(v_sem_produto), 0);
    v_msg := '';
    IF v_n_ind > 0 THEN
      v_msg := 'Faltam ' || v_n_ind || ' item(ns) para decidir se vão para o estoque'; END IF;
    IF v_n_sem > 0 THEN
      v_msg := v_msg || CASE WHEN v_msg <> '' THEN '; e ' ELSE '' END
                     || v_n_sem || ' item(ns) vão para o estoque mas falta vincular o produto'; END IF;
    v_msg := v_msg || '.';
    RETURN jsonb_build_object('ok', false, 'erro', 'itens_nao_resolvidos', 'mensagem', v_msg,
      'indecisos',   COALESCE(v_indecisos,   '[]'::jsonb),
      'sem_produto', COALESCE(v_sem_produto, '[]'::jsonb)); END IF;

  -- 2+3) estoque e financeiro num subbloco atômico: se um falhar, desfaz tudo (nada de meio-concluído)
  BEGIN
    v_est := fn_nfe_recebida_dar_entrada_estoque(v.id);
    IF NOT COALESCE((v_est->>'ok')::boolean,false) THEN RAISE EXCEPTION 'estoque_falhou'; END IF;
    v_pag := fn_nfe_recebida_gerar_pagar(v.id);
    IF NOT COALESCE((v_pag->>'ok')::boolean,false) THEN RAISE EXCEPTION 'financeiro_falhou'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falha_ao_concluir', 'estoque', v_est, 'financeiro', v_pag);
  END;

  UPDATE erp_nfe_recebidas SET concluida_em = now(), concluida_por = auth.uid(), updated_at = now() WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'concluida_em', now(), 'estoque', v_est, 'financeiro', v_pag);
END $function$;
