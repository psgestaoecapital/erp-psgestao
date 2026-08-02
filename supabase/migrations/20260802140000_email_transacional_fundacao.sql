-- RD-41 · PACOTE ADMIN · SPEC 🅰️ — Fundação de Email Transacional (a peça-mãe).
-- Um canal único e confiável reusado por convite (🅲) e reset de senha (🅳).
-- Provedor: Resend (via pg_net POST). Chave SÓ no Vault (RESEND_API_KEY/EMAIL_FROM),
-- NUNCA no código. Idempotência + log em erp_email_log. Nunca falha silenciosa.
--
-- 🔒 SEGREDO: a função lê a chave de vault.decrypted_secrets em tempo de execução.
--    O CEO cadastra RESEND_API_KEY + EMAIL_FROM no Vault (fora do MCP). Sem eles,
--    fn_enviar_email retorna erro claro ('sem_provedor') e LOGA — não trava o chamador.
-- 🔒 pg_net é assíncrono: http_post despacha e a resposta chega depois (o worker só vê a
--    request após COMMIT). Então o status síncrono é 'enviado' (despachado); a confirmação
--    (message_id do Resend / HTTP 200) é reconciliada de net._http_response por fn_email_reconciliar.

-- ─────────────────────────────────────────────────────────────
-- 1 · LOG (aditivo): rastreio + reenvio + diagnóstico. Sem PII além do destino.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destino text NOT NULL,
  template text NOT NULL,
  assunto text,
  idempotency_key text,               -- token/dedupe (ex.: invite_code, reset token)
  status text NOT NULL DEFAULT 'pendente',   -- pendente | enviado | entregue | erro | sem_provedor
  provider text NOT NULL DEFAULT 'resend',
  provider_request_id text,           -- id da request no pg_net (net._http_response.id)
  provider_message_id text,           -- id do Resend (reconciliado)
  http_status int,                    -- status HTTP reconciliado
  erro text,
  company_id uuid,                    -- auditoria opcional
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_log_idem ON public.erp_email_log(template, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_log_req  ON public.erp_email_log(provider_request_id) WHERE provider_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_log_criado ON public.erp_email_log(criado_em DESC);

ALTER TABLE public.erp_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_email_log_sel ON public.erp_email_log;
CREATE POLICY erp_email_log_sel ON public.erp_email_log FOR SELECT
  USING (is_admin());   -- só admin PS lê o log (dado sensível de acesso). Escrita = SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────
-- 2 · TEMPLATES (versionável): render de assunto + HTML com identidade PS
--     (Espresso #3D2314 / Dourado #C8941A). Sem dependência externa.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_email_render(p_template text, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := COALESCE(NULLIF(btrim(p_dados->>'nome'), ''), 'você');
  v_empresa text := NULLIF(btrim(p_dados->>'empresa'), '');
  v_link text := COALESCE(p_dados->>'link', '#');
  v_assunto text; v_titulo text; v_corpo text; v_cta text; v_html text;
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
  ELSE
    RETURN NULL;   -- template desconhecido
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

-- ─────────────────────────────────────────────────────────────
-- 3 · ENVIAR: idempotente, loga tudo, nunca falha silenciosa.
--     Interno (sem GRANT a authenticated): chamado pelas funções de convite/reset
--     (SECURITY DEFINER, rodam como owner) e por admin/serviço. Evita spam por cliente.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_enviar_email(p_destino text, p_template text, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_key text; v_from text; v_render jsonb; v_idem text := NULLIF(p_dados->>'idempotency_key', '');
  v_id uuid; v_req bigint; v_existe uuid;
BEGIN
  IF p_destino IS NULL OR position('@' in p_destino) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'destino inválido');
  END IF;

  -- idempotência: mesmo template+token já enviado com sucesso → não relança
  IF v_idem IS NOT NULL THEN
    SELECT id INTO v_existe FROM erp_email_log
     WHERE template = p_template AND idempotency_key = v_idem AND status IN ('enviado','entregue')
     ORDER BY criado_em DESC LIMIT 1;
    IF v_existe IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'email_id', v_existe, 'idempotente', true);
    END IF;
  END IF;

  v_render := public.fn_email_render(p_template, p_dados);
  IF v_render IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'template desconhecido: ' || COALESCE(p_template,'<null>'));
  END IF;

  -- chave do Vault (nunca do código). Ausente → erro claro + log, sem travar o chamador.
  SELECT decrypted_secret INTO v_key  FROM vault.decrypted_secrets WHERE name = 'RESEND_API_KEY' LIMIT 1;
  SELECT decrypted_secret INTO v_from FROM vault.decrypted_secrets WHERE name = 'EMAIL_FROM' LIMIT 1;

  IF v_key IS NULL OR v_from IS NULL THEN
    INSERT INTO erp_email_log (destino, template, assunto, idempotency_key, status, erro, company_id)
    VALUES (p_destino, p_template, v_render->>'assunto', v_idem, 'sem_provedor',
            'RESEND_API_KEY/EMAIL_FROM ausentes no Vault', NULLIF(p_dados->>'company_id','')::uuid)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', false, 'erro', 'Provedor de email não configurado (RESEND_API_KEY/EMAIL_FROM no Vault).', 'email_id', v_id);
  END IF;

  INSERT INTO erp_email_log (destino, template, assunto, idempotency_key, status, company_id)
  VALUES (p_destino, p_template, v_render->>'assunto', v_idem, 'pendente', NULLIF(p_dados->>'company_id','')::uuid)
  RETURNING id INTO v_id;

  -- despacha via pg_net (assíncrono; fire após commit). A chave vai só no header da request.
  v_req := net.http_post(
    url := 'https://api.resend.com/emails',
    body := jsonb_build_object('from', v_from, 'to', jsonb_build_array(p_destino),
                               'subject', v_render->>'assunto', 'html', v_render->>'html'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key)
  );

  UPDATE erp_email_log SET status = 'enviado', provider_request_id = v_req::text, atualizado_em = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'email_id', v_id, 'request_id', v_req, 'status', 'enviado');
EXCEPTION WHEN OTHERS THEN
  -- nunca falha silenciosa: loga e devolve o erro
  UPDATE erp_email_log SET status = 'erro', erro = SQLERRM, atualizado_em = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', false, 'erro', SQLERRM, 'email_id', v_id);
END $function$;

-- ─────────────────────────────────────────────────────────────
-- 4 · RECONCILIAR: confirma entrega lendo net._http_response (message_id do Resend,
--     HTTP status). Idempotente. Rodável por cron/admin depois do envio.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_email_reconciliar(p_max int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int := 0; r record; v_status int; v_content jsonb; v_errmsg text;
BEGIN
  FOR r IN
    SELECT id, provider_request_id FROM erp_email_log
     WHERE status = 'enviado' AND provider_message_id IS NULL AND provider_request_id IS NOT NULL
     ORDER BY criado_em DESC LIMIT GREATEST(1, LEAST(p_max, 1000))
  LOOP
    SELECT status_code,
           CASE WHEN content ~ '^\s*[{\[]' THEN content::jsonb ELSE NULL END,
           error_msg
      INTO v_status, v_content, v_errmsg
      FROM net._http_response WHERE id = r.provider_request_id::bigint;
    IF NOT FOUND THEN CONTINUE; END IF;   -- ainda não processado pelo worker
    UPDATE erp_email_log SET
      http_status = v_status,
      provider_message_id = COALESCE(v_content->>'id', provider_message_id),
      status = CASE WHEN v_status BETWEEN 200 AND 299 THEN 'entregue' ELSE 'erro' END,
      erro = CASE WHEN v_status BETWEEN 200 AND 299 THEN erro
                  ELSE COALESCE(v_errmsg, v_content->>'message', 'HTTP ' || COALESCE(v_status::text,'?')) END,
      atualizado_em = now()
    WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'reconciliados', v_n);
END $function$;

-- GRANTs: fn_enviar_email é interno (sem authenticated). Reconciliar/render idem.
-- (As funções de convite/reset — SECURITY DEFINER — chamam fn_enviar_email como owner.)
REVOKE ALL ON FUNCTION public.fn_enviar_email(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_email_reconciliar(int) FROM PUBLIC;
