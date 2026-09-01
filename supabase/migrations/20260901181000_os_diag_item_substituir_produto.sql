-- Oficina · Bloco A Path 2 (não-preço) — substituir item de diagnóstico texto-livre por peça do estoque.
-- A Jordana quer, na tela de finalização da OS, clicar num item digitado, buscar no estoque e
-- substituir sem sair da tela. 413 peças texto-livre esperando. Isto habilita o vínculo produto_id
-- (que a reserva/baixa do Bloco D usa) e a rastreabilidade — SEM tocar no preço (decisão de preço
-- na substituição segue bloqueada pela Jordana).
--
-- RPC pequena e cirúrgica (RD-26/RD-57): seta produto_id no item existente, escopo por empresa,
-- só peça, e SÓ enquanto a OS não foi faturada (depois vira ajuste de contas a receber, não aqui).

CREATE OR REPLACE FUNCTION public.fn_os_diag_item_substituir(p_diag_item_id uuid, p_produto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item erp_os_diagnostico_item%ROWTYPE; v_prod record; v_os record;
BEGIN
  SELECT * INTO v_item FROM erp_os_diagnostico_item WHERE id = p_diag_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item de diagnóstico não encontrado.'); END IF;
  IF NOT (v_item.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF v_item.tipo NOT IN ('peca','peça','produto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só item de PEÇA pode ser substituído por produto do estoque.'); END IF;

  -- depois de faturada, mexer em item é na tela de contas a receber, não aqui
  SELECT titulos_gerados, status INTO v_os FROM erp_os WHERE id = v_item.os_id;
  IF COALESCE(v_os.titulos_gerados, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS já faturada — substituição de item não é mais permitida aqui.'); END IF;

  SELECT id, nome, codigo INTO v_prod FROM erp_produtos WHERE id = p_produto_id AND company_id = v_item.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Produto não encontrado nesta empresa.'); END IF;

  -- Substitui: liga o item ao produto real (rastreável, habilita reserva/baixa). Nome vira o do produto.
  -- NÃO toca em preco (decisão de preço na substituição pendente com a Jordana).
  UPDATE erp_os_diagnostico_item
     SET produto_id = v_prod.id,
         descricao  = v_prod.nome
   WHERE id = p_diag_item_id;

  RETURN jsonb_build_object('ok', true, 'produto_id', v_prod.id, 'descricao', v_prod.nome, 'codigo', v_prod.codigo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_diag_item_substituir(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_os_diag_item_substituir(uuid, uuid) TO authenticated, service_role;
