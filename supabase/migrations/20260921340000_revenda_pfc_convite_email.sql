-- Revenda PF-c (follow-up) · botão "Enviar ao meu contador" — e-mail do convite pela FILA existente.
--
-- Depende do PF-b (#1647) e da fundação de e-mail (fn_email_render/fn_enviar_email). Aditivo/idempotente.
-- 1) fn_email_render ganha o template 'revenda_convite_contador' (identidade PS, CTA para o link sem login).
-- 2) fn_veic_perfil_convite_criar passa a aceitar p_base_url e, quando há e-mail, ENFILEIRA o convite pela
--    fn_enviar_email (SECURITY DEFINER interna — o cliente não a chama direto; a criar roda como owner).
--    O envio é best-effort e idempotente (idempotency_key = token): se o provedor falhar, o link ainda volta.

-- (1) template do convite do contador (corpo idêntico em estilo aos demais; só novo ramo ELSIF).
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
  ELSIF p_template = 'revenda_convite_contador' THEN
    v_assunto := 'Perfil fiscal' || COALESCE(' · ' || v_empresa, '') || ' — preencha sem login';
    v_titulo  := 'Preencha o perfil fiscal da revenda';
    v_corpo   := 'Olá. ' || COALESCE('A ' || v_empresa, 'Uma revenda') || ' pediu que você, contador(a), preencha o perfil fiscal dela — '
              || 'regime, CFOP/CST por operação e a base legal de cada resposta. É <b>sem login</b>: o botão abaixo abre o formulário. '
              || 'O link vale 15 dias e é de uso único ao enviar para aprovação.';
    v_cta     := 'Preencher o perfil fiscal';
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

-- (2) criar convite + (best-effort) enfileira o e-mail com o link completo (p_base_url + url_path).
-- Remove a assinatura antiga (4 args) para não deixar overload ambíguo — o único chamador é a Tela 11,
-- que passa p_base_url (5 args). Recria a GRANT para authenticated (dono/PS; anon nunca cria convite).
DROP FUNCTION IF EXISTS public.fn_veic_perfil_convite_criar(uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_criar(p_company_id uuid, p_email text, p_user uuid DEFAULT NULL, p_ip text DEFAULT NULL, p_base_url text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_token text; v_perfil uuid; v_id uuid; v_email text := NULLIF(btrim(p_email),''); v_link text; v_empresa text; v_enfileirado boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_perfil := fn_veic_perfil_rascunho_id(p_company_id, 'contador');
  UPDATE veic_perfil_convite SET status='revogado' WHERE company_id=p_company_id AND status='ativo';
  INSERT INTO veic_perfil_convite (company_id, perfil_id, email_contador, token_hash, expira_em, criado_por, ip_criacao)
  VALUES (p_company_id, v_perfil, v_email, encode(digest(v_token,'sha256'),'hex'), now() + interval '15 days', p_user, p_ip)
  RETURNING id INTO v_id;

  IF v_email IS NOT NULL THEN
    v_link := COALESCE(rtrim(NULLIF(btrim(p_base_url),''), '/'), '') || '/contador/' || v_token;
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_empresa FROM companies WHERE id = p_company_id;
    BEGIN
      PERFORM fn_enviar_email(v_email, 'revenda_convite_contador',
        jsonb_build_object('empresa', v_empresa, 'link', v_link, 'idempotency_key', v_token, 'company_id', p_company_id::text));
      v_enfileirado := true;
    EXCEPTION WHEN OTHERS THEN v_enfileirado := false;  -- o link volta de qualquer forma
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'convite_id', v_id, 'token', v_token,
    'url_path', '/contador/' || v_token, 'expira_em', now() + interval '15 days',
    'email', v_email, 'email_enfileirado', v_enfileirado);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_criar(uuid, text, uuid, text, text) TO authenticated;
