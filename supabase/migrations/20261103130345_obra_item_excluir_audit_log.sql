-- RD-98 p4: exclusão de item de escopo da obra (/dashboard/projetos/obras) rastreável no
-- audit_log_global central, com o AUTOR da exclusão.
--
-- A fn_obra_item_excluir já fazia soft-delete (excluido_em) e guardava o motivo em observacoes, mas
-- NÃO registrava quem excluiu nem gravava na trilha única public.audit_log_global. Agora espelha o
-- padrão das demais exclusões do Hub (fn_crm_visita_excluir, fn_obra_tarefa_excluir), gravando o
-- autor (auth.uid()) e o evento no audit_log_global.
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento (inclusive a
-- trava de item já medido e o recálculo de valor_previsto da obra); acrescenta um único INSERT no
-- audit_log_global. Nenhum dado de cliente é removido; a guarda por company_id permanece intacta.
CREATE OR REPLACE FUNCTION public.fn_obra_item_excluir(p_item_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_obra uuid; v_medido numeric;
BEGIN
  SELECT company_id, obra_id, quantidade_medida INTO v_company, v_obra, v_medido FROM projetos_obra_item WHERE id = p_item_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','item_nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(v_medido,0) > 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','item_ja_medido','mensagem','Este item já foi medido e não pode ser removido do escopo.'); END IF;
  UPDATE projetos_obra_item
     SET excluido_em = now(), atualizado_em = now(),
         observacoes = COALESCE(observacoes,'') || ' | Excluído: ' || COALESCE(p_motivo,'sem motivo')
   WHERE id = p_item_id;
  UPDATE projetos_obras
     SET valor_previsto = (SELECT COALESCE(SUM(valor_contratado),0) FROM projetos_obra_item WHERE obra_id = v_obra AND excluido_em IS NULL),
         updated_at = now()
   WHERE id = v_obra;
  -- RD-98 p4: trilha central de auditoria com o autor (mesmo padrão de fn_obra_tarefa_excluir)
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v_company, auth.uid(), 'projetos_obra_item', p_item_id, 'excluir',
            jsonb_build_object('excluido_em', now(), 'obra_id', v_obra, 'motivo', COALESCE(p_motivo,'sem motivo')));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_obra_item_excluir(uuid, text) FROM anon;
