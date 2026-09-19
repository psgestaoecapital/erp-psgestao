-- E-mails de chamado perdidos em aprovação em lote (19/09) — fila + reenvio + registro de CADA envio
--
-- CAUSA (provada): fn_sugestao_aprovar_resposta envia SÍNCRONO via fn_enviar_email dentro da aprovação.
-- 45 aprovações em ~1 min = 45 net.http_post; e fn_enviar_email marca erp_email_log 'enviado' no ENFILEIRE
-- (pg_net é assíncrono) sem ler net._http_response → erro do provedor (429/limite) fica invisível; e onde
-- o net.http_post estourou no burst, email_enviado_em ficou NULL sem reenvio. fn_email_reconciliar existe
-- mas NÃO tinha cron. Resultado: 13 dos 45 sem email_enviado_em, falha silenciosa.
--
-- CORREÇÃO (RD-70): (1) registrar o resultado real de cada envio → cron chama fn_email_reconciliar
-- (grava entregue/erro + mensagem do provedor em erp_email_log). (2) Fila assíncrona com ritmo controlado
-- e backoff: fn_sugestao_email_fila envia N por minuto, reabre os que o provedor rejeitou, e marca 'falhou'
-- após N tentativas (visível no painel por email_status). (3) A aprovação passa a só ENFILEIRAR (sem burst).

-- ── CAUSA RAIZ REAL (achada pela prova, RD-38): o template 'chamado_resposta' NÃO existe em
-- fn_email_render (só convite/reset_senha/boas_vindas/contrato_evento) → todo e-mail de resposta caía em
-- "template desconhecido" e nunca renderizava/enviava. Sem esse template, fila/retry não adiantam.
-- Registra o template (escapa a resposta livre do PS para não quebrar o HTML).
CREATE OR REPLACE FUNCTION public.fn_email_render(p_template text, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := COALESCE(NULLIF(btrim(p_dados->>'nome'), ''), 'você');
  v_empresa text := NULLIF(btrim(p_dados->>'empresa'), '');
  v_link text := COALESCE(p_dados->>'link', '#');
  v_assunto text; v_titulo text; v_corpo text; v_cta text; v_html text;
  v_numero text := NULLIF(btrim(p_dados->>'numero'), '');
  v_tit_ch text := NULLIF(btrim(p_dados->>'titulo_chamado'), '');
  v_resp text := NULLIF(btrim(p_dados->>'resposta'), '');
BEGIN
  IF p_template = 'convite' THEN
    v_assunto := COALESCE('Seu acesso' || CASE WHEN v_empresa IS NOT NULL THEN ' · ' || v_empresa ELSE '' END, 'Seu acesso ao PS Gestão');
    v_titulo  := 'Bem-vindo(a) ao PS Gestão';
    v_corpo   := 'Olá, ' || v_nome || '. Você foi convidado(a) para acessar' || COALESCE(' a ' || v_empresa, ' o PS Gestão') || '. Toque no botão abaixo para criar sua senha e entrar.';
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
  ELSIF p_template = 'contrato_evento' THEN
    v_assunto := COALESCE(NULLIF(btrim(p_dados->>'assunto'),''), 'Atualização de contrato · PS Gestão');
    v_titulo  := COALESCE(NULLIF(btrim(p_dados->>'titulo_email'),''), 'Contrato');
    v_corpo   := COALESCE(NULLIF(btrim(p_dados->>'corpo'),''), 'Há uma atualização no seu contrato. Abra para ver.');
    v_cta     := COALESCE(NULLIF(btrim(p_dados->>'cta'),''), 'Ver contrato');
  ELSIF p_template = 'chamado_resposta' THEN
    v_assunto := 'Resposta ao seu chamado' || CASE WHEN v_numero IS NOT NULL THEN ' #' || v_numero ELSE '' END || ' · PS Gestão';
    v_titulo  := 'A PS respondeu seu chamado';
    -- escapa a resposta (texto livre do PS) e o título do chamado para não quebrar o HTML.
    v_corpo   := 'Olá, ' || v_nome || '. Sobre '
                 || COALESCE('"' || replace(replace(replace(v_tit_ch,'&','&amp;'),'<','&lt;'),'>','&gt;') || '"', 'seu chamado') || ':' || E'\n\n'
                 || COALESCE(replace(replace(replace(v_resp,'&','&amp;'),'<','&lt;'),'>','&gt;'), '') || E'\n\n'
                 || 'Abra a Central de Melhorias para ver e confirmar se resolveu.';
    v_cta     := 'Ver na Central de Melhorias';
  ELSE
    RETURN NULL;   -- template desconhecido
  END IF;

  v_html :=
    '<!doctype html><html><body style="margin:0;background:#FAF7F2;font-family:Segoe UI,Arial,sans-serif;color:#3D2314;">'
    || '<div style="max-width:520px;margin:0 auto;padding:32px 20px;">'
    || '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#C8941A;font-weight:700;">PS Gestão &amp; Capital</div>'
    || '<div style="background:#FFFFFF;border:1px solid #E7DECF;border-radius:16px;padding:28px 24px;margin-top:12px;">'
    || '<h1 style="font-size:20px;margin:0 0 12px;color:#3D2314;">' || v_titulo || '</h1>'
    || '<p style="font-size:14px;line-height:1.6;color:#5B4636;margin:0 0 22px;white-space:pre-line;">' || v_corpo || '</p>'
    || '<a href="' || v_link || '" style="display:inline-block;background:#C8941A;color:#3D2314;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px;">' || v_cta || '</a>'
    || '<p style="font-size:11px;color:#9C8E80;margin:22px 0 0;word-break:break-all;">Se o botão não funcionar, copie e cole: ' || v_link || '</p>'
    || '</div>'
    || '<p style="font-size:11px;color:#9C8E80;text-align:center;margin-top:16px;">Este é um email automático do PS Gestão. Não responda.</p>'
    || '</div></body></html>';
  RETURN jsonb_build_object('assunto', v_assunto, 'html', v_html);
END $function$;

-- ── (colunas de fila na notificação) ────────────────────────────────────────────────────────────────
ALTER TABLE public.sugestao_notificacao
  ADD COLUMN IF NOT EXISTS email_tentativas      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_ultimo_erro     text,
  ADD COLUMN IF NOT EXISTS email_proxima_tentativa timestamptz,
  ADD COLUMN IF NOT EXISTS email_status          text NOT NULL DEFAULT 'pendente', -- pendente|enviado|falhou
  ADD COLUMN IF NOT EXISTS email_log_id          uuid;

-- Notificações que JÁ tinham sido enviadas não podem virar 'pendente' (o default) e serem reenviadas:
-- marca como 'enviado' quem já tem email_enviado_em. As NULL ficam 'pendente' (entram na fila/reenvio).
UPDATE public.sugestao_notificacao SET email_status = 'enviado'
 WHERE email_enviado_em IS NOT NULL AND email_status <> 'enviado';

-- A fila SÓ envia tipo='resposta'. As notificações 'mensagem'/'reaberto' são só in-app (nunca viraram
-- e-mail). Deixá-las como 'pendente' (o default da coluna) é um ledger que MENTE — e um dia alguém tira o
-- filtro por tipo e dispara centenas de e-mails antigos a clientes reais. Marca-as 'nao_aplicavel' para o
-- estado dizer a verdade e a fila jamais tocá-las. Idempotente (não mexe em enviado/falhou).
UPDATE public.sugestao_notificacao SET email_status = 'nao_aplicavel'
 WHERE tipo <> 'resposta' AND email_enviado_em IS NULL
   AND coalesce(email_status,'pendente') NOT IN ('nao_aplicavel','falhou');

-- ── Worker da fila de e-mail de resposta (ritmo controlado + backoff + falhou) ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_sugestao_email_fila(p_max integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  r record; v_mail jsonb; v_enviados int := 0; v_falhas int := 0; v_reabertos int := 0;
  v_max_tentativas int := 6;
BEGIN
  IF NOT (v_interno OR auth.role() = 'service_role'
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Só PS_ADMIN/cron processa a fila de e-mail' USING errcode = '42501';
  END IF;

  -- (1) registra o resultado real de cada envio já feito (entregue/erro + msg do provedor)
  PERFORM public.fn_email_reconciliar(200);

  -- (2) reabre os que o provedor REJEITOU (erp_email_log 'erro'): volta pra fila com backoff, até o teto.
  FOR r IN
    SELECT n.id, n.email_tentativas, l.erro
      FROM sugestao_notificacao n
      JOIN erp_email_log l ON l.id = n.email_log_id
     WHERE n.tipo = 'resposta' AND n.email_status = 'enviado' AND l.status = 'erro'
  LOOP
    IF r.email_tentativas + 1 >= v_max_tentativas THEN
      UPDATE sugestao_notificacao
         SET email_status = 'falhou', email_enviado_em = NULL, email_tentativas = r.email_tentativas + 1,
             email_ultimo_erro = left(coalesce(r.erro,'erro provedor'), 500)
       WHERE id = r.id;
    ELSE
      UPDATE sugestao_notificacao
         SET email_status = 'pendente', email_enviado_em = NULL, email_tentativas = r.email_tentativas + 1,
             email_ultimo_erro = left(coalesce(r.erro,'erro provedor'), 500),
             email_proxima_tentativa = now() + (CASE r.email_tentativas WHEN 0 THEN interval '2 min'
               WHEN 1 THEN interval '5 min' WHEN 2 THEN interval '15 min' WHEN 3 THEN interval '30 min'
               ELSE interval '60 min' END)
       WHERE id = r.id;
    END IF;
    v_reabertos := v_reabertos + 1;
  END LOOP;

  -- (3) envia os PENDENTES devidos, no máximo p_max por chamada (ritmo controlado → respeita o provedor).
  FOR r IN
    SELECT n.id AS notif_id, s.id AS sugestao_id, s.user_email, s.user_name, s.numero, s.titulo,
           s.resposta, s.company_id, n.email_tentativas
      FROM sugestao_notificacao n
      JOIN sugestoes s ON s.id = n.sugestao_id
     WHERE n.tipo = 'resposta' AND n.email_enviado_em IS NULL AND n.email_status = 'pendente'
       AND (n.email_proxima_tentativa IS NULL OR n.email_proxima_tentativa <= now())
       AND s.user_email IS NOT NULL AND position('@' in s.user_email) > 0
       AND coalesce(btrim(s.resposta),'') <> ''
     ORDER BY n.criado_em
     LIMIT GREATEST(1, LEAST(p_max, 50))
  LOOP
    v_mail := public.fn_enviar_email(r.user_email, 'chamado_resposta', jsonb_build_object(
      'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', r.resposta,
      'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
      'idempotency_key', 'chamado-resp-' || r.sugestao_id::text, 'company_id', r.company_id));
    IF COALESCE((v_mail->>'ok')::boolean, false) THEN
      UPDATE sugestao_notificacao
         SET email_enviado_em = now(), email_status = 'enviado',
             email_log_id = NULLIF(v_mail->>'email_id','')::uuid, email_ultimo_erro = NULL
       WHERE id = r.notif_id;
      v_enviados := v_enviados + 1;
    ELSE
      IF r.email_tentativas + 1 >= v_max_tentativas THEN
        UPDATE sugestao_notificacao SET email_status='falhou', email_tentativas=r.email_tentativas+1,
               email_ultimo_erro=left(coalesce(v_mail->>'erro','falha'),500) WHERE id=r.notif_id;
      ELSE
        UPDATE sugestao_notificacao SET email_tentativas=r.email_tentativas+1,
               email_ultimo_erro=left(coalesce(v_mail->>'erro','falha'),500),
               email_proxima_tentativa = now() + (CASE r.email_tentativas WHEN 0 THEN interval '2 min'
                 WHEN 1 THEN interval '5 min' WHEN 2 THEN interval '15 min' WHEN 3 THEN interval '30 min'
                 ELSE interval '60 min' END)
         WHERE id=r.notif_id;
      END IF;
      v_falhas := v_falhas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'enviados', v_enviados, 'falhas_agora', v_falhas,
    'reabertos', v_reabertos,
    'pendentes_restantes', (SELECT count(*) FROM sugestao_notificacao WHERE tipo='resposta' AND email_enviado_em IS NULL AND email_status='pendente'),
    'falhou_total', (SELECT count(*) FROM sugestao_notificacao WHERE tipo='resposta' AND email_status='falhou'));
END; $$;

REVOKE ALL ON FUNCTION public.fn_sugestao_email_fila(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_email_fila(integer) TO authenticated, service_role;

-- ── Aprovação passa a só ENFILEIRAR (sem envio síncrono → sem burst) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
        v_email text; v_nome text; v_company uuid; v_notif uuid;
        v_redigida uuid; v_redator_email text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id, resposta_redigida_por
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company, v_redigida
    FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;

  UPDATE sugestoes SET resposta_aprovada = true, resposta_aprovada_por = p_user, resposta_aprovada_em = now(), updated_at = now()
  WHERE id = p_id;

  SELECT email INTO v_redator_email FROM users WHERE id = COALESCE(v_redigida, p_user);
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
  SELECT p_id, COALESCE(v_redigida, p_user), v_redator_email, 'ps', v_resp, now()
  WHERE NOT EXISTS (SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id = p_id AND m.papel = 'ps' AND btrim(m.texto) = btrim(v_resp));

  -- Enfileira a notificação (email_status='pendente', proxima_tentativa=agora). O envio é assíncrono e com
  -- ritmo controlado por fn_sugestao_email_fila (cron 1 min) — nada de burst síncrono na aprovação.
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem, email_status, email_proxima_tentativa)
  VALUES (p_id, v_autor, 'resposta',
          '#' || v_numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.', 'pendente', now())
  RETURNING id INTO v_notif;

  RETURN jsonb_build_object('ok', true, 'notificado', v_autor, 'email_enfileirado', true);
END $function$;

-- ── Cron: drena a fila a cada minuto (8/min = dentro do limite do provedor) ──────────────────────────
SELECT cron.schedule('sugestao-email-fila-1min', '* * * * *', 'SELECT public.fn_sugestao_email_fila(8)');
