-- PM / Leads (CRM) (#baa3c770 PDCA · RD-98 p4 rastro da exclusão)
-- fn_crm_lead_excluir fazia soft-delete (deleted_at) e checava permissão, mas NÃO gravava
-- QUEM excluiu nem escrevia audit_log — rastro de exclusão incompleto.
-- Mudança ADITIVA: coluna deleted_by em agency_leads + CREATE OR REPLACE da RPC existente
-- (assinatura inalterada) para gravar deleted_by e escrever audit_log_global
-- (padrão fn_agency_comissao_marcar_paga). Sem mudar RLS (agency_leads já tem RLS por company_id).

ALTER TABLE public.agency_leads
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

COMMENT ON COLUMN public.agency_leads.deleted_by IS 'Usuário que excluiu (soft-delete) o lead — rastro RD-98 p4.';

CREATE OR REPLACE FUNCTION public.fn_crm_lead_excluir(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_uid uuid := auth.uid();
BEGIN
  SELECT company_id, responsavel_id, criado_por, deleted_at INTO v_lead
    FROM agency_leads WHERE id = p_lead_id;
  IF v_lead.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT (is_admin() OR v_uid = v_lead.responsavel_id OR v_uid = v_lead.criado_por) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'orientacao', 'Apenas o responsável, quem criou o lead ou um administrador podem excluí-lo.'); END IF;
  IF v_lead.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE agency_leads SET deleted_at = now(), deleted_by = v_uid, atualizado_em = now() WHERE id = p_lead_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_lead.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_leads', p_lead_id::text,
          'crm_lead_excluir',
          jsonb_build_object('deleted_at', NULL),
          jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));

  RETURN jsonb_build_object('ok', true, 'id', p_lead_id, 'excluido', true);
END;
$function$;

-- check-fn-guards regra 1 (revoke_anon): SECURITY DEFINER exige REVOKE explícito no arquivo.
-- CREATE OR REPLACE preserva a ACL viva ({postgres,authenticated,service_role}); as linhas abaixo só a refletem.
REVOKE ALL ON FUNCTION public.fn_crm_lead_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_lead_excluir(uuid) TO authenticated, service_role;
