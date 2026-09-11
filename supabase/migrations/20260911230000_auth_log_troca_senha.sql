-- ============================================================
-- Auth — registrar a troca de senha na trilha do ERP (Pilar 2 / LGPD)
-- ============================================================
-- Contexto: o fluxo de recovery do Supabase autenticava com a senha ANTIGA e não forçava a troca.
-- O PR do frontend passa a exigir a nova senha (/auth/nova-senha) e encerrar as outras sessões.
-- Aqui só o LOG: autenticação sem trilha é problema em si (auth.audit_log_entries está vazio — config
-- do projeto Supabase, fora do código). Registramos a troca no audit_log do ERP (já em uso, 900+ linhas).

CREATE OR REPLACE FUNCTION public.fn_audit_senha_trocada(p_via text DEFAULT 'recovery', p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_sessao');
  END IF;
  SELECT email INTO v_email FROM public.users WHERE id = v_uid;
  INSERT INTO public.audit_log (id, user_id, user_email, action, detail, module, user_agent, created_at)
  VALUES (gen_random_uuid(), v_uid, v_email, 'senha_trocada',
          'Senha redefinida via ' || COALESCE(p_via,'?') || ' · outras sessões encerradas.',
          'auth', left(COALESCE(p_user_agent,''),500), now());
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_audit_senha_trocada(text,text) TO authenticated, service_role;
