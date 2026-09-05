-- Aviso por e-mail quando a resposta do chamado é APROVADA (regra decidida com o CEO):
--  1) Um e-mail na APROVAÇÃO — é o momento em que a pessoa precisa saber.
--  2) UM lembrete, UMA vez, após 2 dias sem confirmar. Não diário (repetir sem novidade vira spam).
--  3) Para aí: dois avisos e acabou. Insistir queima o canal.
--  4) Só vale para resposta APROVADA e NÃO confirmada. Chamado que espera a GENTE não cobra o usuário
--     (ex.: #24 depende do BPO; cobrar a Julia por algo que não é dela seria pior que o silêncio).
-- Reusa sugestao_notificacao (já sabe o destinatário) + fn_enviar_email/fn_email_render/erp_email_log.
-- WhatsApp não existe (sem provedor no Vault) — fica para depois, se o CEO decidir bancar.
-- Falha de envio NÃO é silenciosa: registra em erp_ia_falha (fn_ia_falha_registrar) — 5ª falha silenciosa
-- desta semana seria demais. E o e-mail nunca trava a aprovação (padrão "IA/efeito nunca bloqueia").

-- ── 1. rastro na notificação: não mandar 2x + o lembrete único ────────────────────────────────
ALTER TABLE public.sugestao_notificacao
  ADD COLUMN IF NOT EXISTS email_enviado_em    timestamptz,   -- aviso 1 (aprovação)
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em  timestamptz;  -- aviso 2 (lembrete único)

-- ── 2. URL base do app (server-side; o cron do lembrete não tem frontend pra passar o host) ─────
-- Vault APP_BASE_URL quando houver domínio próprio; senão o alias de produção (mesmo fallback do front).
CREATE OR REPLACE FUNCTION public.fn_app_base_url()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT rtrim(COALESCE(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'APP_BASE_URL' LIMIT 1),
    'https://erp-psgestao.vercel.app'), '/');
$function$;

-- ── 3. fn_email_render + 2 templates do chamado (aprovada + lembrete) ──────────────────────────
-- CREATE OR REPLACE substitui a função inteira: preservo os ramos existentes e acrescento os dois novos.
CREATE OR REPLACE FUNCTION public.fn_email_render(p_template text, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := COALESCE(NULLIF(btrim(p_dados->>'nome'), ''), 'você');
  v_empresa text := NULLIF(btrim(p_dados->>'empresa'), '');
  v_link text := COALESCE(p_dados->>'link', '#');
  v_assunto text; v_titulo text; v_corpo text; v_cta text; v_html text;
  v_num text := COALESCE(p_dados->>'numero', '');
  v_tit_ch text := COALESCE(NULLIF(btrim(p_dados->>'titulo_chamado'),''), 'sua solicitação');
  v_resp text;
BEGIN
  IF p_template = 'convite' THEN
    v_assunto := COALESCE('Seu acesso' || CASE WHEN v_empresa IS NOT NULL THEN ' · ' || v_empresa ELSE '' END, 'Seu acesso ao PS Gestão');
    v_titulo  := 'Bem-vindo(a) ao PS Gestão';
    v_corpo   := 'Olá, ' || v_nome || '. Você foi convidado(a) para acessar' ||
                 COALESCE(' a ' || v_empresa, ' o PS Gestão') || '. Toque no botão abaixo para criar sua senha e entrar.';
    v_cta     := 'Ativar meu acesso';
  ELSIF p_template = 'reset_senha' THEN
    v_assunto := 'Redefinir sua senha · PS Gestão';
    v_titulo  := 'Redefinição de senha';
    v_corpo   := 'Recebemos um pedido para redefinir sua senha. Toque no botão abaixo (o link expira em breve). Se não foi você, ignore este email.';
    v_cta     := 'Redefinir senha';
  ELSIF p_template = 'boas_vindas' THEN
    v_assunto := 'Tudo pronto · PS Gestão';
    v_titulo  := 'Acesso ativado';
    v_corpo   := 'Olá, ' || v_nome || '. Seu acesso está ativo. Bom trabalho!';
    v_cta     := 'Entrar';
  ELSIF p_template IN ('chamado_resposta', 'chamado_lembrete') THEN
    -- resposta com escape básico + quebras de linha → <br> (vai dentro do <p> do esqueleto)
    v_resp := replace(replace(replace(replace(COALESCE(p_dados->>'resposta',''),
                '&','&amp;'),'<','&lt;'),'>','&gt;'), E'\n', '<br>');
    IF p_template = 'chamado_resposta' THEN
      v_assunto := '#' || v_num || ' · Respondemos seu chamado — PS Gestão';
      v_titulo  := 'Respondemos seu chamado #' || v_num;
      v_corpo   := 'Olá, ' || v_nome || '. Sobre o seu chamado <b>#' || v_num || ' · ' || v_tit_ch || '</b>:'
                   || '<br><br><b>Nossa resposta:</b><br>' || COALESCE(NULLIF(v_resp,''),'(sem texto)')
                   || '<br><br>Se resolveu, confirme em um clique. Se ainda não, você pode responder por aqui mesmo.';
      v_cta     := 'Ver e confirmar';
    ELSE
      v_assunto := 'Lembrete · seu chamado #' || v_num || ' aguarda sua confirmação';
      v_titulo  := 'Seu chamado #' || v_num || ' está resolvido?';
      v_corpo   := 'Olá, ' || v_nome || '. Respondemos o seu chamado <b>#' || v_num || ' · ' || v_tit_ch || '</b> há alguns dias e ainda não tivemos seu retorno.'
                   || '<br><br><b>Nossa resposta:</b><br>' || COALESCE(NULLIF(v_resp,''),'(sem texto)')
                   || '<br><br>Pode confirmar se resolveu — ou responder — em um clique? Este é o último lembrete; depois é só nos chamar quando precisar.';
      v_cta     := 'Confirmar agora';
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  v_html :=
    '<!doctype html><html><body style="margin:0;background:#FAF7F2;font-family:Segoe UI,Arial,sans-serif;color:#3D2314;">'
    || '<div style="max-width:520px;margin:0 auto;padding:32px 20px;">'
    || '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#C8941A;font-weight:700;">PS Gestão &amp; Capital</div>'
    || '<div style="background:#FFFFFF;border:1px solid #E7DECF;border-radius:16px;padding:28px 24px;margin-top:12px;">'
    || '<h1 style="font-size:20px;margin:0 0 12px;color:#3D2314;">' || v_titulo || '</h1>'
    || '<p style="font-size:14px;line-height:1.6;color:#5B4636;margin:0 0 22px;">' || v_corpo || '</p>'
    || '<a href="' || v_link || '" style="display:inline-block;background:#C8941A;color:#3D2314;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px;">' || v_cta || '</a>'
    || '<p style="font-size:11px;color:#9C8E80;margin:22px 0 0;word-break:break-all;">Se o botão não funcionar, copie e cole: ' || v_link || '</p>'
    || '</div>'
    || '<p style="font-size:11px;color:#9C8E80;text-align:center;margin-top:16px;">Este é um email automático do PS Gestão. Não responda.</p>'
    || '</div></body></html>';

  RETURN jsonb_build_object('assunto', v_assunto, 'html', v_html);
END $function$;

-- ── 4. aprovar a resposta AGORA também dispara o e-mail (aviso 1). Best-effort: nunca trava a aprovação.
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
        v_email text; v_nome text; v_company uuid; v_notif uuid; v_mail jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role = 'PS_ADMIN') THEN
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
      -- 'sem_provedor' é lacuna de config CONHECIDA (RESEND_API_KEY/EMAIL_FROM ausentes) e já fica em
      -- erp_email_log — não vira erp_ia_falha (senão toda aprovação cria alarme falso). Só falha REAL alarma.
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

-- ── 5. o LEMBRETE único (aviso 2): 2 dias sem confirmar → um e-mail, e para. Roda no cron. ──────
CREATE OR REPLACE FUNCTION public.fn_sugestao_lembrete_confirmacao()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rec record; v_mail jsonb; v_enviados int := 0; v_falhas int := 0;
BEGIN
  FOR v_rec IN
    -- pega a notificação de RESPOSTA mais recente de cada chamado aprovado, não confirmado, há ≥2 dias,
    -- que ainda NÃO recebeu o lembrete. Chamado sem resposta aprovada não entra (regra 4).
    SELECT DISTINCT ON (s.id)
           s.id AS sugestao_id, s.numero, s.titulo, s.resposta, s.user_email, s.user_name, s.company_id,
           n.id AS notif_id
      FROM sugestoes s
      JOIN sugestao_notificacao n ON n.sugestao_id = s.id AND n.tipo = 'resposta'
     WHERE s.resposta_aprovada = true
       AND COALESCE(s.confirmado_pelo_autor, false) = false
       AND s.resposta_aprovada_em <= now() - interval '2 days'
       AND n.lembrete_enviado_em IS NULL
     ORDER BY s.id, n.criado_em DESC
  LOOP
    -- marca ANTES de enviar: garante "uma vez só" mesmo se o envio falhar (não reenfileira amanhã).
    UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_rec.notif_id;
    IF v_rec.user_email IS NULL OR position('@' in v_rec.user_email) = 0 THEN CONTINUE; END IF;
    BEGIN
      v_mail := public.fn_enviar_email(v_rec.user_email, 'chamado_lembrete', jsonb_build_object(
        'nome', v_rec.user_name, 'numero', v_rec.numero, 'titulo_chamado', v_rec.titulo, 'resposta', v_rec.resposta,
        'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || v_rec.numero,
        'idempotency_key', 'chamado-lembrete-' || v_rec.sugestao_id::text, 'company_id', v_rec.company_id));
      IF COALESCE((v_mail->>'ok')::boolean, false) THEN v_enviados := v_enviados + 1;
      ELSIF COALESCE(v_mail->>'erro','') NOT ILIKE '%não configurado%' THEN
        v_falhas := v_falhas + 1;   -- 'sem_provedor' não alarma (config conhecida); só falha real
        PERFORM fn_ia_falha_registrar('pg','fn_sugestao_lembrete_confirmacao','email_lembrete_confirmacao','email:resend',
                NULL, COALESCE(v_mail->>'erro','falha_email'), v_rec.company_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas + 1;
      PERFORM fn_ia_falha_registrar('pg','fn_sugestao_lembrete_confirmacao','email_lembrete_confirmacao','email:resend',
              NULL, SQLERRM, v_rec.company_id);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'lembretes_enviados', v_enviados, 'falhas', v_falhas);
END $function$;

-- ── 6. cron do lembrete: diário 11:00 UTC (08:00 BRT). Cada chamado recebe no máx. 1 (guardado acima).
SELECT cron.schedule('sugestao-lembrete-confirmacao-diario', '0 11 * * *',
  $$SELECT public.fn_sugestao_lembrete_confirmacao();$$);
