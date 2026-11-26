-- RD-98 p4 (exclusão rastreável) — Hub › Orçamento por EAP (/dashboard/projetos/obras/[id]/orcamento, tela 316).
-- fn_projetos_orcamento_item_eap_excluir já faz SOFT-DELETE (excluido_em/excluido_por) e sai da árvore EAP, mas NÃO
-- gravava o rastro em audit_log_global. O auditor PDCA Hub (23/11, "orcamento(96) bloqueado por RD-98 p4
-- (fn_projetos_orcamento_item_eap_excluir sem audit_log)") apontou esse gap como o único que segurava o selo da tela.
-- Esta migration adiciona o log de exclusão EXATAMENTE no padrão já em produção (20261125214845,
-- prod_apontamento_hora): INSERT em audit_log_global com valor_anterior = o item + seu complemento EAP, ANTES de
-- marcar como excluído, e idempotente (não re-loga nem re-exclui um item já excluído).
--
-- Área: Hub › Projetos/Orçamento. NÃO é núcleo financeiro de cliente; não toca dado de cliente. RLS inalterada; a
-- guarda por company_id (get_user_company_ids) permanece idêntica. Nada muda no comportamento visível: só passa a
-- existir o rastro de quem excluiu o quê. RD-26: mesma forma do padrão de exclusão rastreável já em produção.
-- RD-94.1: CREATE OR REPLACE de função existente é SENSÍVEL -> label revisao-eng-chefe.
-- RD-38: audit_log_global hoje tem 0 registros acao='delete' de 'erp_orcamentos_itens'; prova leve (INSERT com
--        to_jsonb do item+eap real da Construtora DEMO) em BEGIN/ROLLBACK anexada ao PR.

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_excluir(p_item_id uuid, p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_item    public.erp_orcamentos_itens%ROWTYPE;
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
  SELECT i.* INTO v_item
  FROM public.erp_orcamentos_itens i
  WHERE i.id = p_item_id
    AND i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item % não encontrado neste orçamento', p_item_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: se já estava excluído, não re-loga nem re-exclui (evita rastro duplicado em re-chamada).
  IF v_item.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'ja_excluido', true);
  END IF;

  -- RD-98 p4: rastro da exclusão em audit_log_global ANTES de apagar (item + complemento EAP, para poder reconstruir).
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (v_company, auth.uid(), 'erp_orcamentos_itens', p_item_id::text, 'delete',
          jsonb_build_object(
            'item', to_jsonb(v_item),
            'eap', (SELECT to_jsonb(e) FROM public.projetos_orcamento_item_eap e
                     WHERE e.orcamento_item_id = p_item_id AND e.company_id = v_company)));

  -- Sai da árvore EAP (complemento 1:1).
  DELETE FROM public.projetos_orcamento_item_eap
  WHERE orcamento_item_id = p_item_id
    AND company_id = v_company;

  -- Marca o item compartilhado como excluído (com rastro). O WHERE excluido_em IS NULL preserva a idempotência.
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

-- Guarda da régua check-fn-guards (grants preservados: eram authenticated + service_role; nunca anon).
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_excluir(uuid, uuid) TO authenticated, service_role;
