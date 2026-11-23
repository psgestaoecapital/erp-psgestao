-- Backend RD-98 p2 do Orçamento por EAP (§315 C-2): listar e excluir item.
-- A UI /dashboard/projetos/obras/[id]/orcamento (merge #5818) já consome estas duas
-- RPCs, mas elas NUNCA foram publicadas em produção (o #5814 que as traria não foi
-- mergeado). Prova RD-38 (pg_proc, 22/11): só _arvore, _salvar e _importar existem;
-- _listar e _excluir faltam → a chamada falha → setItens([]) → o bloco "Itens do
-- orçamento" (Editar/Excluir) nunca aparece → RD-98 p2 morto em produção.
-- Esta migration é ADITIVA (duas funções NOVAS). Mesmo contrato/guarda da _salvar.

-- ============================================================================
-- fn_projetos_orcamento_item_eap_listar(p_orcamento_id)
--   → { itens: [ { item_id, servico_id, servico_codigo, servico_descricao,
--                  unidade, eap_codigo, local_tipo, local_nome, quantidade,
--                  custo_material_unit, custo_mao_obra_unit, subtotal } ] }
--   Lista os itens VIVOS (excluido_em IS NULL) que têm complemento EAP, para a
--   tela poder editar/excluir cada um. Guarda por empresa do orçamento.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_listar(
  p_orcamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_itens   jsonb;
BEGIN
  -- Guarda: o orçamento tem de ser de uma empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'item_id',             i.id,
             'servico_id',          i.servico_id,
             'servico_codigo',      i.servico_codigo,
             'servico_descricao',   i.servico_descricao,
             'unidade',             i.unidade,
             'eap_codigo',          e.eap_codigo,
             'local_tipo',          e.local_tipo,
             'local_nome',          e.local_nome,
             'quantidade',          i.quantidade,
             'custo_material_unit', e.custo_material_unit,
             'custo_mao_obra_unit', e.custo_mao_obra_unit,
             'subtotal',            i.subtotal
           )
           ORDER BY e.eap_codigo NULLS LAST, e.local_nome NULLS LAST, i.created_at
         ), '[]'::jsonb)
  INTO v_itens
  FROM public.erp_orcamentos_itens i
  JOIN public.projetos_orcamento_item_eap e ON e.orcamento_item_id = i.id
  WHERE i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company
    AND i.excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END;
$function$;

-- ============================================================================
-- fn_projetos_orcamento_item_eap_excluir(p_item_id, p_orcamento_id)
--   → { ok: true }
--   Remove o complemento EAP (sai da árvore) e marca o item compartilhado como
--   excluído (com rastro: excluido_em / excluido_por). O trigger
--   recalc_orcamento_total recalcula o total (soma só excluido_em IS NULL).
--   Guarda por empresa do orçamento. Idempotente para item já excluído.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_excluir(
  p_item_id      uuid,
  p_orcamento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_found   uuid;
BEGIN
  -- Guarda: o orçamento tem de ser de uma empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  -- O item tem de ser deste orçamento e desta empresa.
  SELECT i.id INTO v_found
  FROM public.erp_orcamentos_itens i
  WHERE i.id = p_item_id
    AND i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'item % não encontrado neste orçamento', p_item_id USING ERRCODE = 'P0002';
  END IF;

  -- Sai da árvore EAP (complemento 1:1).
  DELETE FROM public.projetos_orcamento_item_eap
  WHERE orcamento_item_id = p_item_id
    AND company_id = v_company;

  -- Marca o item compartilhado como excluído (com rastro). Idempotente:
  -- se já estava excluído, o WHERE não casa e o trigger não re-dispara à toa.
  UPDATE public.erp_orcamentos_itens
     SET excluido_em  = now(),
         excluido_por = auth.uid()
   WHERE id = p_item_id
     AND orcamento_id = p_orcamento_id
     AND company_id = v_company
     AND excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- Segurança: nunca anônimo; só usuário autenticado (a guarda de empresa está no corpo).
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) TO authenticated;
