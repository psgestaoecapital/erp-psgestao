-- Hub · Orçamento por EAP (tela 315) · RD-98 p4: a EXCLUSÃO de item do orçamento passa a gravar audit_log_global.
-- Gap do PDCA 25/11 (jornada do orçamento EAP): fn_projetos_orcamento_item_eap_excluir fazia soft-delete
-- (excluido_em/excluido_por) mas NÃO deixava rastro em audit_log_global. RD-98 p4 (incluir/editar/excluir com
-- rastro) exige o registro da exclusão.
--
-- Mudança MÍNIMA e aditiva: toda a guarda por empresa, o DELETE do complemento EAP e o UPDATE de soft-delete
-- ficam IDÊNTICOS. Só acrescenta: (1) captura do item ANTES (valor_anterior), (2) GET DIAGNOSTICS do UPDATE e
-- (3) um INSERT em audit_log_global quando — e só quando — uma linha foi de fato excluída (idempotente: repetir
-- a exclusão de um item já excluído não gera novo rastro). SECURITY DEFINER e search_path preservados.
-- Nenhum dado de cliente é alterado; nenhuma coluna/tabela nova.
-- RD-52: arquivo em supabase/migrations + PR, versão acima da main (faixa dev4g :45–:54).

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_excluir(p_item_id uuid, p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_found   uuid;
  v_antes   jsonb;
  v_cnt     int := 0;
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

  -- Estado do item ANTES da exclusão (para o rastro). NULL se já estava excluído (não gera novo rastro).
  SELECT to_jsonb(i) INTO v_antes
  FROM public.erp_orcamentos_itens i
  WHERE i.id = p_item_id
    AND i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company
    AND i.excluido_em IS NULL;

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
  GET DIAGNOSTICS v_cnt = ROW_COUNT;

  -- RD-98 p4: rastro da exclusão em audit_log_global — só quando houve exclusão de fato.
  IF v_cnt > 0 THEN
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_orcamentos_itens', p_item_id::text, 'ORCAMENTO_ITEM_EAP_EXCLUIDO',
            v_antes, jsonb_build_object('excluido_em', now(), 'orcamento_id', p_orcamento_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- Guardas de privilégio (check:fn-guards): SECURITY DEFINER sem acesso a anon; só authenticated/service_role.
-- Idempotente e alinhado ao estado vivo em produção (anon já não possui EXECUTE).
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) TO authenticated, service_role;
