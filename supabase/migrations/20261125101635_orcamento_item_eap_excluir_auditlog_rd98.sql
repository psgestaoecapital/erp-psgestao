-- fix(projetos/orcamento-eap · tela 315 · RD-98 p4): exclusão de item do orçamento grava audit_log
--
-- GAP (PDCA auditor_pdca_1, jornada tela 315 na main c391fa4, DEMO Construtora/FC):
-- fn_projetos_orcamento_item_eap_excluir já grava quem/quando (excluido_em/excluido_por) mas NÃO
-- escreve na trilha central de auditoria (audit_log_global). As telas IRMÃS já seladas da mesma
-- vertical gravam: fn_crm_oportunidade_excluir (oportunidades, selada 96) e fn_simulador_excluir
-- (simulador, selada 97). Falta paridade de RD-98 p4 (exclusão rastreável) para a tela 315 selar.
--
-- FIX: acrescenta um INSERT em public.audit_log_global no mesmo padrão das irmãs, gatilhado só quando
-- a exclusão REALMENTE acontece (GET DIAGNOSTICS = ROW_COUNT > 0) — mantém a idempotência: re-chamar
-- num item já excluído não gera linha de auditoria duplicada. Nada mais muda (guarda por empresa,
-- soft-delete do item compartilhado, DELETE físico do complemento 1:1 da árvore EAP permanecem iguais).
--
-- Aditivo: apenas CREATE OR REPLACE da função. Não toca/apaga dado de cliente (o DELETE do complemento
-- EAP é link estrutural 1:1, já existente). Toca orçamento (compartilhado com Comércio) → via revisada.
--
-- PROVA NO PR (RD-38, BEGIN…ROLLBACK, DEMO): excluir 1 item de orçamento EAP gera exatamente 1 linha
-- em audit_log_global (tabela=erp_orcamentos_itens, acao=excluir, registro_id=item, user_id=autor);
-- a listagem segue filtrando excluido_em IS NULL e o total recalcula; 2ª chamada no mesmo item = 0
-- linhas novas de auditoria (idempotente).

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_excluir(p_item_id uuid, p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_found   uuid;
  v_n       int;
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
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_crm_oportunidade_excluir / fn_simulador_excluir).
  -- Só quando a exclusão aconteceu de fato (idempotente: re-chamar não duplica a linha).
  IF v_n > 0 THEN
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (v_company, auth.uid(), 'erp_orcamentos_itens', p_item_id, 'excluir',
              jsonb_build_object('deleted_at', now(), 'orcamento_id', p_orcamento_id, 'origem', 'orcamento_eap'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- AJUSTES revisor (check_fn_guards · revoke_anon): CREATE OR REPLACE reseta a ACL; re-aplica o fecho
-- padrão da vertical — REVOKE anon/PUBLIC + GRANT só a authenticated/service_role (ACL viva: authenticated=X,
-- service_role=X; sem anon). Sem este bloco o CREATE OR REPLACE tiraria o EXECUTE de authenticated e quebraria a tela.
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) TO authenticated, service_role;
