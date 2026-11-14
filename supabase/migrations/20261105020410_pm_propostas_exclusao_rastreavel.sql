-- PM · /dashboard/pm/propostas · RD-98 p4 (exclusão rastreável) — fecha o único gap da nota 94→≥95.
-- Hoje fn_agency_proposta_excluir faz soft-delete (deleted_at) mas NÃO registra QUEM excluiu nem grava
-- auditoria. Esta migration é ADITIVA: acrescenta o rastro (deleted_by/deleted_motivo) e o audit_log_global,
-- sem apagar nada e sem mudar o comportamento de listagem (a tela já filtra deleted_at IS NULL).

-- 1) Colunas de rastro (aditivas, nuláveis — nada é reescrito).
ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS deleted_motivo text;

-- 2) Nova assinatura com motivo opcional. Dropamos a versão (uuid) antiga para não deixar overload
--    ambíguo (chamada com 1 arg escolheria entre duas candidatas). A chamada atual do front
--    (apenas p_id) continua funcionando via DEFAULT de p_motivo.
DROP FUNCTION IF EXISTS public.fn_agency_proposta_excluir(uuid);

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_del timestamptz; v_titulo text; v_status text;
  v_uid uuid := auth.uid();
BEGIN
  SELECT company_id, deleted_at, titulo, status
    INTO v_comp, v_del, v_titulo, v_status
    FROM public.agency_propostas WHERE id = p_id;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  -- Guarda por empresa (multi-tenant): só a própria empresa ou admin.
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- Idempotência: já excluída → nada a fazer (não duplica auditoria).
  IF v_del IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluida', true, 'id', p_id); END IF;

  -- RD-98 p4: rastro de quem/quando excluiu + estado anterior, antes do soft-delete.
  INSERT INTO audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, v_uid, (SELECT email FROM users WHERE id = v_uid),
     'agency_propostas', p_id::text, 'proposta_excluida',
     jsonb_build_object('titulo', v_titulo, 'status', v_status),
     jsonb_build_object('excluido', true, 'excluido_por', v_uid, 'motivo', p_motivo));

  -- Soft-delete (RD-98 p4: nunca DELETE físico). A listagem segue filtrando deleted_at IS NULL.
  UPDATE public.agency_propostas
     SET deleted_at = now(), deleted_by = v_uid, deleted_motivo = p_motivo, updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END
$function$;

-- 3) Guarda de função SECURITY DEFINER (check_fn_guards · regra 1 · revoke_anon):
--    fecha IDOR via anon/PUBLIC. ACL viva = {authenticated, service_role}.
REVOKE ALL ON FUNCTION public.fn_agency_proposta_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_excluir(uuid, text) TO authenticated, service_role;
