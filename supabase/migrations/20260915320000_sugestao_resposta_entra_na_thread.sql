-- ============================================================
-- #79 · a resposta aprovada tem que ENTRAR na conversa (thread), não só virar e-mail
-- ============================================================
-- Hoje a resposta vive em sugestoes.resposta (gated por resposta_aprovada) e NUNCA é inserida em
-- sugestao_mensagem (a thread que a tela mostra). Por isso o autor vê só as próprias mensagens —
-- "parece que estou conversando sozinho" (Rodrigo). Correção: ao APROVAR, insere a resposta na thread
-- (papel 'ps', cronológica). Pendente (não aprovada) continua fora — correto.
-- Provado no dado (RD-38): 50 respostas aprovadas existem e NENHUMA está na thread (o CEO estimou 10).

-- (1) Aprovar passa a inserir a resposta na thread (idempotente: não duplica a mesma resposta)
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
        v_email text; v_nome text; v_company uuid; v_notif uuid; v_mail jsonb;
        v_redigida uuid; v_redator_email text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id, resposta_redigida_por
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company, v_redigida
    FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;

  UPDATE sugestoes SET
    resposta_aprovada = true, resposta_aprovada_por = p_user, resposta_aprovada_em = now(), updated_at = now()
  WHERE id = p_id;

  -- #79 · a resposta aprovada entra na CONVERSA (papel 'ps'), em ordem cronológica. Idempotente.
  SELECT email INTO v_redator_email FROM users WHERE id = COALESCE(v_redigida, p_user);
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
  SELECT p_id, COALESCE(v_redigida, p_user), v_redator_email, 'ps', v_resp, now()
  WHERE NOT EXISTS (
    SELECT 1 FROM sugestao_mensagem m
    WHERE m.sugestao_id = p_id AND m.papel = 'ps' AND btrim(m.texto) = btrim(v_resp));

  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'resposta',
          '#' || v_numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.')
  RETURNING id INTO v_notif;

  BEGIN
    IF v_email IS NOT NULL AND position('@' in v_email) > 0 THEN
      v_mail := public.fn_enviar_email(v_email, 'chamado_resposta', jsonb_build_object(
        'nome', v_nome, 'numero', v_numero, 'titulo_chamado', v_titulo, 'resposta', v_resp,
        'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || v_numero,
        'idempotency_key', 'chamado-resp-' || p_id::text, 'company_id', v_company));
      IF COALESCE((v_mail->>'ok')::boolean, false) THEN
        UPDATE sugestao_notificacao SET email_enviado_em = now() WHERE id = v_notif;
      ELSIF COALESCE(v_mail->>'erro','') NOT ILIKE '%não configurado%' THEN
        PERFORM fn_ia_falha_registrar('pg','fn_sugestao_aprovar_resposta','email_resposta_aprovada','email:resend',
                NULL, COALESCE(v_mail->>'erro','falha_email'), v_company);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM fn_ia_falha_registrar('pg','fn_sugestao_aprovar_resposta','email_resposta_aprovada','email:resend',
            NULL, SQLERRM, v_company);
  END;

  RETURN jsonb_build_object('ok', true, 'notificado', v_autor, 'email', COALESCE((v_mail->>'ok')::boolean, false));
END $function$;

-- (2) BACKFILL · insere na thread as respostas já aprovadas que nunca entraram, com a DATA DE APROVAÇÃO.
--     autor_id é NOT NULL → cai para redator/aprovador/atendente e, em último caso, para um PS_ADMIN.
DO $backfill$
DECLARE v_fallback uuid;
BEGIN
  SELECT id INTO v_fallback FROM public.users WHERE system_role IN ('PS_ADMIN_CVM','PS_ADMIN') ORDER BY system_role LIMIT 1;
  INSERT INTO public.sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
  SELECT s.id,
         COALESCE(s.resposta_redigida_por, s.resposta_aprovada_por, s.atendente_id, v_fallback),
         u.email, 'ps', s.resposta,
         COALESCE(s.resposta_aprovada_em, s.updated_at, now())
  FROM public.sugestoes s
  LEFT JOIN public.users u ON u.id = COALESCE(s.resposta_redigida_por, s.resposta_aprovada_por, s.atendente_id, v_fallback)
  WHERE s.resposta_aprovada = true
    AND COALESCE(btrim(s.resposta),'') <> ''
    AND COALESCE(s.resposta_redigida_por, s.resposta_aprovada_por, s.atendente_id, v_fallback) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.sugestao_mensagem m
      WHERE m.sugestao_id = s.id AND m.papel = 'ps' AND btrim(m.texto) = btrim(s.resposta));
END $backfill$;
