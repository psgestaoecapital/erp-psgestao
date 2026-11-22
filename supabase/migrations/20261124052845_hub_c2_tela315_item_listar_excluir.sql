-- Hub · Onda C-2 · tela 315 (Orçamento por EAP) — slice 3: listar e EXCLUIR item (RD-98 incluir/editar/excluir).
-- Aditiva: cria DUAS funções novas (nenhum ALTER/DROP em objeto existente). Escrita guardada por empresa.
--  - fn_projetos_orcamento_item_eap_listar: lista os itens do orçamento (para editar/excluir na tela).
--  - fn_projetos_orcamento_item_eap_excluir: remove o item — apaga o complemento EAP (sai da árvore) e marca o
--    item compartilhado (erp_orcamentos_itens) como excluído (excluido_em), disparando o recálculo do total.
-- A edição reaproveita fn_projetos_orcamento_item_eap_salvar(..., p_item_id) já publicada.

-- ───────────────────────────── LISTAR ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_listar(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_itens   jsonb;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'eap_codigo', x->>'servico_descricao'), '[]'::jsonb)
    INTO v_itens
  FROM (
    SELECT jsonb_build_object(
             'item_id',             i.id,
             'servico_id',          i.servico_id,
             'servico_codigo',      i.servico_codigo,
             'servico_descricao',   i.servico_descricao,
             'unidade',             i.unidade,
             'eap_codigo',          e.eap_codigo,
             'local_tipo',          e.local_tipo,
             'local_nome',          COALESCE(e.local_nome, lt.nome),
             'quantidade',          e.quantidade,
             'custo_material_unit', e.custo_material_unit,
             'custo_mao_obra_unit', e.custo_mao_obra_unit,
             'subtotal',            round(e.quantidade * (COALESCE(e.custo_material_unit,0) + COALESCE(e.custo_mao_obra_unit,0)), 2)
           ) AS x
    FROM public.projetos_orcamento_item_eap e
    JOIN public.erp_orcamentos_itens i
      ON i.id = e.orcamento_item_id
     AND i.orcamento_id = p_orcamento_id
     AND i.excluido_em IS NULL
    LEFT JOIN public.projetos_local_tipo lt ON lt.codigo = e.local_tipo
    WHERE e.company_id = v_company
  ) q;

  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'itens', COALESCE(v_itens, '[]'::jsonb));
END;
$function$;

-- ───────────────────────────── EXCLUIR ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_excluir(p_item_id uuid, p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_del     uuid;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  -- Marca o item compartilhado como excluído (dispara recalc_orcamento_total). Só itens desta empresa/orçamento.
  UPDATE public.erp_orcamentos_itens
     SET excluido_em = now()
   WHERE id = p_item_id
     AND orcamento_id = p_orcamento_id
     AND company_id = v_company
     AND excluido_em IS NULL
  RETURNING id INTO v_del;
  IF v_del IS NULL THEN
    RAISE EXCEPTION 'item % não encontrado neste orçamento', p_item_id USING ERRCODE = 'P0002';
  END IF;

  -- Remove o complemento EAP (sai da árvore do orçamento).
  DELETE FROM public.projetos_orcamento_item_eap
   WHERE orcamento_item_id = p_item_id
     AND company_id = v_company;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- Guarda: só o usuário autenticado chama; nunca anônimo.
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) TO authenticated;
