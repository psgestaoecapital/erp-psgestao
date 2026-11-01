-- RD-98 p4 (exclusão rastreável) para /dashboard/pm/propostas: hoje fn_agency_proposta_excluir faz soft-delete
-- (deleted_at) mas NÃO registra QUEM excluiu nem grava trilha de auditoria. Este é o único gap do auditor (94→95).
-- Mesma doutrina já aplicada em fn_agency_servico_excluir (deleted_by + audit_log_global).
--
-- Mudanças (ADITIVAS):
--   1) coluna agency_propostas.deleted_by (uuid, nullable) — quem excluiu;
--   2) CREATE OR REPLACE de fn_agency_proposta_excluir: grava deleted_by = auth.uid() e INSERT em audit_log_global.
-- Mantém assinatura (p_id uuid), formato de retorno e a guarda de empresa já existentes.
-- Segurança: auth.uid() (autoria não forjável), guarda por empresa (get_user_company_ids/is_admin), REVOKE anon.
-- Code: dev7claudeps

ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS deleted_by uuid;
COMMENT ON COLUMN public.agency_propostas.deleted_by IS 'Usuário que fez o soft-delete da proposta (auth.uid na exclusão). RD-98 p4.';

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_p public.agency_propostas%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.agency_propostas WHERE id = p_id;
  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  -- guarda de empresa (inalterada): só quem tem acesso à empresa da proposta, ou admin
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_p.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluida', true, 'id', p_id); END IF;

  -- soft-delete RASTREÁVEL: registra quem e quando
  UPDATE public.agency_propostas
     SET deleted_at = now(), deleted_by = v_uid, updated_at = now()
   WHERE id = p_id;

  -- trilha de auditoria (mesmo padrão de fn_agency_servico_excluir)
  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_p.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
          'agency_propostas', p_id::text, 'proposta_excluida',
          jsonb_build_object('numero', v_p.numero, 'titulo', v_p.titulo, 'status', v_p.status, 'valor_final', v_p.valor_final),
          jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_proposta_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_excluir(uuid) TO authenticated;
