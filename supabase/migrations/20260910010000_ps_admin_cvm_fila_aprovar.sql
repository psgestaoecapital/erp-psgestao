-- ============================================================
-- PS_ADMIN_CVM ganha acesso à Fila de Atendimento (ver + aprovar) — decisão do CEO (10/09)
--
-- Dor: o CEO é PS_ADMIN_CVM e trabalha nas 10 empresas, mas o papel estava fora da fila de suporte
-- em 3 níveis: (1) guard da tela, (2) fn_pode_ver_fila_suporte (RLS da fila), (3) aprovar exigia
-- system_role='PS_ADMIN'. Por isso os rascunhos que ele "aprovava" nunca chegavam ao autor —
-- ficavam resposta_aprovada=false. (A tela é frontend, tratada no PR; aqui vão os 2 pontos de banco.)
--
-- Decisão do CEO: PS_ADMIN_CVM = papel de plataforma com acesso igual a PS_ADMIN na fila (ver + aprovar).
-- (Há 2 usuários com esse papel; ambos passam a ver a fila das empresas e aprovar respostas.)
-- ============================================================

-- 1) Ver a fila (usado pela RLS de sugestoes e pela view v_sugestao_fila).
CREATE OR REPLACE FUNCTION public.fn_pode_ver_fila_suporte()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM'))
$function$;

-- 2) Aprovar resposta (envia ao autor): PS_ADMIN e PS_ADMIN_CVM. Corpo idêntico ao vivo, só o guard muda.
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
        v_email text; v_nome text; v_company uuid; v_notif uuid; v_mail jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company
    FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;

  UPDATE sugestoes SET
    resposta_aprovada = true, resposta_aprovada_por = p_user, resposta_aprovada_em = now(), updated_at = now()
  WHERE id = p_id;

  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'resposta',
          '#' || v_numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.')
  RETURNING id INTO v_notif;

  -- aviso 1 por e-mail (best-effort). Falha NUNCA invalida a aprovação; falha NÃO é silenciosa (erp_ia_falha).
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
