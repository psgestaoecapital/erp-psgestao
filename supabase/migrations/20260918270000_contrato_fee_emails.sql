-- #59 PDOIS parte 2 · avisos por e-mail do contrato de fee (item d do SPEC).
-- Regra (CEO): responsável avisado ao abrir a solicitação; solicitante avisado a cada mudança de
-- status, pedido de informação e conclusão. Um único ponto de despacho (RD-65): trigger AFTER INSERT
-- em erp_contratos_eventos (as RPCs do #1549 JÁ gravam o evento — não mexemos nelas). Best-effort:
-- falha de e-mail nunca quebra a transição (fn_enviar_email já é idempotente e trata "sem provedor").
-- Idempotente. Reusa fn_enviar_email/fn_email_render/fn_app_base_url do e-mail transacional.

-- ── 1 · Template do contrato no render (assunto/corpo/cta vêm prontos do trigger, que conhece o evento) ─
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
  ELSIF p_template = 'contrato_evento' THEN
    -- copy pronta do trigger (conhece o evento/status). Fallbacks seguros.
    v_assunto := COALESCE(NULLIF(btrim(p_dados->>'assunto'),''), 'Atualização de contrato · PS Gestão');
    v_titulo  := COALESCE(NULLIF(btrim(p_dados->>'titulo_email'),''), 'Contrato');
    v_corpo   := COALESCE(NULLIF(btrim(p_dados->>'corpo'),''), 'Há uma atualização no seu contrato. Abra para ver.');
    v_cta     := COALESCE(NULLIF(btrim(p_dados->>'cta'),''), 'Ver contrato');
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

-- ── 2 · Trigger: despacha o e-mail certo por evento. Solicitação → responsável; status → solicitante. ─
CREATE OR REPLACE FUNCTION public.fn_contrato_evento_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_dest_id uuid; v_email text; v_nome text;
  v_status text; v_status_legivel text; v_assunto text; v_titulo_email text; v_corpo text; v_cta text;
  v_link text; v_titulo_contrato text;
BEGIN
  -- só dois gatilhos de e-mail: 'solicitado' e mudanças de status. Os demais (parcelas_geradas,
  -- fatura_gerada, alterado, excluido) não avisam por e-mail.
  IF NEW.evento <> 'solicitado' AND NEW.evento NOT LIKE 'status_%' THEN
    RETURN NEW;
  END IF;

  SELECT id, numero, nome, cliente_nome, solicitante_id, responsavel_id, company_id
    INTO v_c FROM erp_contratos WHERE id = NEW.contrato_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_titulo_contrato := COALESCE(NULLIF(btrim(v_c.nome),''), 'contrato');
  v_link := public.fn_app_base_url() || '/dashboard/contratos?c=' || v_c.id::text;

  IF NEW.evento = 'solicitado' THEN
    v_dest_id := v_c.responsavel_id;                       -- financeiro que vai elaborar
    v_assunto := format('Novo contrato para elaborar · nº %s', v_c.numero);
    v_titulo_email := 'Novo contrato para elaborar';
    v_corpo := format('Um contrato foi solicitado e aguarda elaboração:%s%snº %s — %s%s%sCliente: %s%sAbra para montar o fee e as parcelas.',
                      E'\n', E'\n', v_c.numero, v_titulo_contrato, E'\n', E'\n',
                      COALESCE(NULLIF(btrim(v_c.cliente_nome),''),'(sem cliente)'), E'\n\n');
    v_cta := 'Abrir para elaborar';
  ELSE
    v_dest_id := v_c.solicitante_id;                       -- quem pediu o contrato
    v_status := regexp_replace(NEW.evento, '^status_', '');
    v_status_legivel := CASE v_status
      WHEN 'solicitado' THEN 'Solicitado'
      WHEN 'em_elaboracao' THEN 'Em elaboração'
      WHEN 'aguardando_info' THEN 'Aguardando informações'
      WHEN 'em_revisao' THEN 'Em revisão'
      WHEN 'aguardando_aprovacao' THEN 'Aguardando aprovação'
      WHEN 'ativo' THEN 'Ativo'
      WHEN 'cancelado' THEN 'Cancelado'
      WHEN 'suspenso' THEN 'Suspenso'
      WHEN 'encerrado' THEN 'Encerrado'
      ELSE initcap(replace(v_status,'_',' ')) END;
    IF v_status = 'aguardando_info' THEN
      v_assunto := format('Pediram uma informação · contrato nº %s', v_c.numero);
      v_titulo_email := 'Falta uma informação';
      v_corpo := format('O responsável precisa de uma informação para seguir com o contrato nº %s — %s:%s%s"%s"%s%sAbra o contrato para responder.',
                        v_c.numero, v_titulo_contrato, E'\n', E'\n', COALESCE(NULLIF(btrim(NEW.detalhe),''),'(sem detalhe)'), E'\n', E'\n');
      v_cta := 'Responder';
    ELSIF v_status = 'ativo' THEN
      v_assunto := format('Contrato concluído · nº %s', v_c.numero);
      v_titulo_email := 'Contrato concluído';
      v_corpo := format('Boa notícia: o contrato nº %s — %s foi concluído e ativado. As parcelas foram lançadas no financeiro.',
                        v_c.numero, v_titulo_contrato);
      v_cta := 'Ver contrato';
    ELSE
      v_assunto := format('Contrato nº %s: %s', v_c.numero, v_status_legivel);
      v_titulo_email := 'Atualização do contrato';
      v_corpo := format('O contrato nº %s — %s mudou de status para: %s.', v_c.numero, v_titulo_contrato, v_status_legivel);
      v_cta := 'Ver contrato';
    END IF;
  END IF;

  IF v_dest_id IS NULL THEN RETURN NEW; END IF;             -- sem destinatário (ex.: sem responsável) → não avisa
  SELECT email, full_name INTO v_email, v_nome FROM users WHERE id = v_dest_id;
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.fn_enviar_email(v_email, 'contrato_evento', jsonb_build_object(
      'nome', COALESCE(NULLIF(btrim(v_nome),''), split_part(v_email,'@',1)),
      'assunto', v_assunto, 'titulo_email', v_titulo_email, 'corpo', v_corpo, 'cta', v_cta,
      'link', v_link,
      'idempotency_key', 'contrato-evt-' || NEW.id::text,   -- 1 e-mail por evento
      'company_id', v_c.company_id));
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- best-effort: e-mail nunca invalida a transição (fn_enviar_email já loga o próprio erro)
  END;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_contrato_evento_email ON public.erp_contratos_eventos;
CREATE TRIGGER trg_contrato_evento_email
  AFTER INSERT ON public.erp_contratos_eventos
  FOR EACH ROW EXECUTE FUNCTION public.fn_contrato_evento_email();
