-- PDCA P&M · /dashboard/pm/propostas · RD-98 p4: EXCLUSÃO RASTREÁVEL
-- Gap (auditor_pdca_2, 31/10, DEMO Agência): fn_agency_proposta_excluir fazia apenas
--   UPDATE agency_propostas SET deleted_at = now() — sem registrar QUEM excluiu e sem
--   escrever em audit_log_global. Numa tela de propostas comerciais, a exclusão tem de
--   deixar rastro (RD-98 p4).
-- Correção (aditiva, mesmo padrão de fn_agency_servico_excluir):
--   1) coluna aditiva deleted_by (quem excluiu);
--   2) a RPC grava deleted_by = auth.uid() e um registro em audit_log_global com
--      valor_anterior/valor_novo.
-- Assinatura (p_id uuid) INALTERADA — o front (src/app/dashboard/pm/propostas/page.tsx)
-- continua chamando fn_agency_proposta_excluir({ p_id }).

ALTER TABLE public.agency_propostas
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p   public.agency_propostas%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.agency_propostas WHERE id = p_id;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada');
  END IF;

  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF v_p.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluida', true, 'id', p_id);
  END IF;

  UPDATE public.agency_propostas
     SET deleted_at = now(), deleted_by = v_uid, updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_p.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_propostas', p_id::text, 'proposta_excluida',
     jsonb_build_object('titulo', v_p.titulo, 'valor_total', v_p.valor_total, 'status', v_p.status),
     jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END
$function$;

-- Reafirma a ACL da função SECURITY DEFINER (gate check-fn-guards / [revoke_anon]).
-- CREATE OR REPLACE só preserva a ACL onde a função já existe; em ambiente novo volta ao
-- default EXECUTE TO PUBLIC. Espelha a ACL viva hoje ({authenticated, service_role}).
REVOKE ALL ON FUNCTION public.fn_agency_proposta_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_excluir(uuid) TO authenticated, service_role;
