-- RD-98 p4: exclusão de anexo do CRM (oportunidades/leads) rastreável no audit_log_global central,
-- com o autor.
--
-- A fn_crm_anexo_excluir já fazia soft-delete (deleted_at; o arquivo permanece no bucket, RD-30) mas
-- NÃO registrava quem excluiu nem gravava na trilha única public.audit_log_global. Agora grava o autor
-- (auth.uid()) e o evento, espelhando o padrão de fn_crm_visita_excluir.
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento; acrescenta um
-- único INSERT no audit_log_global. Guarda por company_id (get_user_company_ids) intacta.
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_excluir(p_anexo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_crm_anexo WHERE id = p_anexo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_crm_anexo SET deleted_at = now() WHERE id = p_anexo_id;   -- soft-delete (RD-30); arquivo fica no bucket
  -- RD-98 p4: trilha central de auditoria com o autor
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_crm_anexo', p_anexo_id, 'excluir',
            jsonb_build_object('deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_crm_anexo_excluir(uuid) FROM anon;
