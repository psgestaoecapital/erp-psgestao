-- ============================================================
-- Fila de Atendimento vira painel · "reenviar aviso" para chamados aprovados sem confirmação do autor
--
-- Pedido do CEO (10/09): 9 chamados (#14,#18,#20-#26) estão aprovados e o autor nunca confirmou —
-- alguns há 7 dias. A tela precisa mostrar "aguardando confirmação há N dias" e um botão "reenviar
-- aviso". Esta RPC re-notifica o autor (notificação in-app + e-mail best-effort, mesmo caminho da
-- aprovação). Quando o Resend estiver configurado, o e-mail dispara; por ora fica a notificação e o
-- CEO enxerga quem cobrar.
--
-- Só re-notifica quando FAZ sentido: resposta aprovada E autor ainda não confirmou. Guarda de acesso
-- igual à fila (PS_ADMIN / PS_SUPPORT / PS_ADMIN_CVM ou admin).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sugestao_reenviar_aviso(p_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
        v_email text; v_nome text; v_company uuid; v_aprovada boolean; v_confirmado boolean;
        v_notif uuid; v_mail jsonb;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id,
         resposta_aprovada, confirmado_pelo_autor
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company, v_aprovada, v_confirmado
    FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_nao_aprovada'); END IF;
  IF COALESCE(v_confirmado, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'autor_ja_confirmou'); END IF;

  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'resposta',
          '#' || v_numero || ' · Lembrete: sua resposta está esperando você',
          'A equipe PS respondeu o seu chamado e está aguardando você confirmar se resolveu. Abra a Central de Melhorias.')
  RETURNING id INTO v_notif;

  -- e-mail best-effort (idempotency por DIA, para o reenvio não colidir com o aviso da aprovação).
  BEGIN
    IF v_email IS NOT NULL AND position('@' in v_email) > 0 THEN
      v_mail := public.fn_enviar_email(v_email, 'chamado_resposta', jsonb_build_object(
        'nome', v_nome, 'numero', v_numero, 'titulo_chamado', v_titulo, 'resposta', v_resp,
        'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || v_numero,
        'idempotency_key', 'chamado-lembrete-' || p_id::text || '-' || to_char(now(),'YYYYMMDD'),
        'company_id', v_company));
      IF COALESCE((v_mail->>'ok')::boolean, false) THEN
        UPDATE sugestao_notificacao SET email_enviado_em = now() WHERE id = v_notif;
      ELSIF COALESCE(v_mail->>'erro','') NOT ILIKE '%não configurado%' THEN
        PERFORM fn_ia_falha_registrar('pg','fn_sugestao_reenviar_aviso','email_lembrete','email:resend',
                NULL, COALESCE(v_mail->>'erro','falha_email'), v_company);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM fn_ia_falha_registrar('pg','fn_sugestao_reenviar_aviso','email_lembrete','email:resend',
            NULL, SQLERRM, v_company);
  END;

  UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_notif;

  RETURN jsonb_build_object('ok', true, 'notificado', v_autor,
    'email', COALESCE((v_mail->>'ok')::boolean, false),
    'email_configurado', COALESCE(v_mail->>'erro','') NOT ILIKE '%não configurado%');
END $function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_reenviar_aviso(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reenviar_aviso(uuid,uuid) TO authenticated, service_role;
