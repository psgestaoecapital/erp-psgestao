-- RD-98 p4: exclusão de oportunidade (CRM / Hub › Projetos › Oportunidades) rastreável também no
-- audit_log_global central.
--
-- A fn_crm_oportunidade_excluir já fazia soft-delete (deleted_at) e registrava quem/quando/por quê em
-- erp_crm_oportunidade_historico. Faltava espelhar o padrão das demais exclusões do Hub
-- (fn_crm_visita_excluir, fn_obra_excluir, fn_proposta_excluir, fn_takeoff_*_excluir) gravando na
-- TRILHA ÚNICA de auditoria — public.audit_log_global — para a exclusão aparecer no mesmo lugar que
-- todas as outras (quem, quando, tabela, registro, ação).
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento; acrescenta um
-- único INSERT no audit_log_global. Nenhum dado de cliente é alterado ou removido; a guarda por
-- company_id (get_user_company_ids) e o SECURITY DEFINER/search_path permanecem intactos.
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_excluir(p_company_id uuid, p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_crm_oportunidade SET deleted_at=now(), updated_at=now()
    WHERE id=p_id AND company_id=p_company_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrada_ou_ja_excluida'); END IF;
  INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,autor_id,detalhe)
    VALUES (p_company_id,p_id,'excluida',auth.uid(),COALESCE(NULLIF(p_motivo,''),'Excluída pelo usuário'));
  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_crm_visita_excluir)
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_crm_oportunidade', p_id, 'excluir',
            jsonb_build_object('deleted_at', now(), 'motivo', COALESCE(NULLIF(p_motivo,''),'Excluída pelo usuário')));
  RETURN jsonb_build_object('ok',true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_excluir(uuid, uuid, text) FROM anon;
