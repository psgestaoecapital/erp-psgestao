-- Agente responde chamado (CEO 04/10, opção A) + e-mails de aviso de chamado que não saíam (RD-81: causa provada).
--
-- (1) E-MAIL — causa PROVADA: fn_enviar_email devolve 'template desconhecido: chamado_resposta' porque o fn_email_render
--     vivo não tem os ramos chamado_resposta/chamado_lembrete. Cada migration que redefiniu o fn_email_render copiou uma
--     base antiga e apagou o ramo da anterior: 20260918270000 (contrato_evento) partiu de uma base sem os do chamado
--     (20260905120000) e 20260921340000 (revenda_convite_contador) partiu de uma sem o contrato_evento. Resultado: a fila
--     (fn_sugestao_email_fila, cron de 1 min) falhava 6x e ia a 'falhou'; contrato_evento também estava sem render.
--     Correção: UMA definição com TODOS os templates (convite, reset_senha, boas_vindas, chamado_resposta,
--     chamado_lembrete, revenda_convite_contador, contrato_evento). O gate check-email-render-templates segura que o
--     último fn_email_render do repo tenha todos os templates que algum fn_enviar_email usa.
--     As notificações 'resposta' que ficaram em 'falhou' por isso voltam à fila (tentativas zeradas); o cron reenvia.
--
-- (2) fn_agente_chamado_responder — a rotina (conexão de serviço) não é usuário (auth.uid() nulo), então não passa pela
--     fn_sugestao_mensagem_enviar. Antes: uma sessão postou "como Gilberto" (#116), outra recusou (#727). Agora há UMA
--     conduta: só a conexão de serviço, só com OK do CEO registrado na caixa, o texto exato fica com hash, a resposta entra
--     na conversa com autor = o CEO que aprovou e rastro aditivo (redigido_por, aprovado_por, ok_ceo_em, mensagem_agente_id,
--     texto_hash — RD-55), e a notificação é a MESMA do caminho normal de aprovação (tipo 'resposta' → e-mail pela
--     fn_sugestao_email_fila — RD-71). Nenhum claim de JWT é forjado.

-- ── rastro aditivo na conversa ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sugestao_mensagem
  ADD COLUMN IF NOT EXISTS redigido_por text,
  ADD COLUMN IF NOT EXISTS aprovado_por uuid,
  ADD COLUMN IF NOT EXISTS ok_ceo_em timestamptz,
  ADD COLUMN IF NOT EXISTS mensagem_agente_id uuid REFERENCES public.erp_agente_mensagem(id),
  ADD COLUMN IF NOT EXISTS texto_hash text,
  ADD COLUMN IF NOT EXISTS ok_ceo_origem text,        -- quem deu o OK: o CEO ou o Eng. Chefe por delegação (RD-94)
  ADD COLUMN IF NOT EXISTS ok_registrado_por text;    -- quem chamou fn_agente_mensagem_ok_ceo

-- configuração única do autor das respostas do agente (não é parâmetro do chamador). Só a conexão de serviço lê (RLS sem política).
CREATE TABLE IF NOT EXISTS public.erp_agente_config (chave text PRIMARY KEY, valor text NOT NULL, atualizado_em timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.erp_agente_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_agente_config FROM PUBLIC, anon, authenticated;
INSERT INTO public.erp_agente_config (chave, valor) VALUES ('chamado_autor_email', 'gilberto.paravizi@gmail.com') ON CONFLICT (chave) DO NOTHING;

-- ── (1) fn_email_render com todos os templates ───────────────────────────────────────────────────────────────────────
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
  ELSIF p_template = 'revenda_convite_contador' THEN
    v_assunto := 'Perfil fiscal' || COALESCE(' · ' || v_empresa, '') || ' — preencha sem login';
    v_titulo  := 'Preencha o perfil fiscal da revenda';
    v_corpo   := 'Olá. ' || COALESCE('A ' || v_empresa, 'Uma revenda') || ' pediu que você, contador(a), preencha o perfil fiscal dela — '
              || 'regime, CFOP/CST por operação e a base legal de cada resposta. É <b>sem login</b>: o botão abaixo abre o formulário. '
              || 'O link vale 15 dias e é de uso único ao enviar para aprovação.';
    v_cta     := 'Preencher o perfil fiscal';
  ELSIF p_template = 'contrato_evento' THEN
    -- copy pronta do trigger (conhece o evento/status). Fallbacks seguros.
    v_assunto := COALESCE(NULLIF(btrim(p_dados->>'assunto'),''), 'Atualização de contrato · PS Gestão');
    v_titulo  := COALESCE(NULLIF(btrim(p_dados->>'titulo_email'),''), 'Contrato');
    v_corpo   := COALESCE(NULLIF(btrim(p_dados->>'corpo'),''), 'Há uma atualização no seu contrato. Abra para ver.');
    v_cta     := COALESCE(NULLIF(btrim(p_dados->>'cta'),''), 'Ver contrato');
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

-- notificações de resposta (até 7 dias) que esgotaram as tentativas só por causa do template ausente voltam à fila (nada é apagado)
UPDATE public.sugestao_notificacao
   SET email_status = 'pendente', email_tentativas = 0, email_proxima_tentativa = now()
 WHERE tipo = 'resposta' AND email_enviado_em IS NULL
   AND email_status IN ('pendente','falhou')
   AND email_ultimo_erro LIKE 'template desconhecido: chamado_resposta%'
   AND criado_em >= now() - interval '7 days';   -- as mais antigas NÃO são reenviadas em massa (Eng. Chefe 04/10): ficam 'falhou', listadas na PR

-- ── (2) a função oficial ───────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_agente_chamado_responder — só a conexão de serviço (fn__agente_assert_servico) e só com OK do CEO na caixa
CREATE OR REPLACE FUNCTION public.fn_agente_chamado_responder(
    p_mensagem_agente uuid, p_sugestao_id uuid, p_texto text, p_novo_status text DEFAULT NULL, p_hash_aprovado text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record; s record; v_ceo_email text; v_ceo_user uuid; v_msg uuid; v_notif uuid; v_status text; v_hash text; v_texto text := btrim(COALESCE(p_texto,''));
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_agente FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.tipo <> 'tarefa' OR NOT m.requer_ok_ceo OR m.ok_ceo_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_ok_do_ceo'); END IF;
  IF m.status IN ('concluida','recusada') OR m.arquivada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF v_texto = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'texto_vazio'); END IF;
  IF p_novo_status IS NOT NULL AND p_novo_status NOT IN ('em_analise','aceita','em_desenvolvimento','aguardando_confirmacao','concluida','recusada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  -- o autor é a conta PS configurada (erp_agente_config), nunca um parâmetro do chamador; tem de ser PS_ADMIN/PS_ADMIN_CVM de verdade
  SELECT u.id, u.email INTO v_ceo_user, v_ceo_email FROM users u
   WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'))
     AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM');
  IF v_ceo_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ceo_nao_identificado'); END IF;
  SELECT id, user_id, numero, titulo, status INTO s FROM sugestoes WHERE id = p_sugestao_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'chamado_nao_encontrado'); END IF;
  IF s.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'chamado_sem_autor'); END IF;   -- sem destinatário não há aviso

  v_hash := encode(sha256(convert_to(v_texto, 'UTF8')), 'hex');
  IF p_hash_aprovado IS NOT NULL AND lower(btrim(p_hash_aprovado)) <> v_hash THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'texto_diferente_do_aprovado', 'texto_hash', v_hash); END IF;
  v_status := CASE WHEN p_novo_status IS NOT NULL THEN p_novo_status
                   WHEN s.status IN ('nova','em_analise','aceita','em_desenvolvimento') OR s.status IS NULL THEN 'aguardando_confirmacao'
                   ELSE s.status END;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em,
                                 redigido_por, aprovado_por, ok_ceo_em, mensagem_agente_id, texto_hash, ok_ceo_origem, ok_registrado_por)
  VALUES (p_sugestao_id, v_ceo_user, v_ceo_email, 'ps', v_texto, now(),
          m.para, v_ceo_user, m.ok_ceo_em, m.id, v_hash, m.ok_ceo_origem, m.ok_registrado_por)
  RETURNING id INTO v_msg;

  -- mesmo efeito de fn_sugestao_aprovar_resposta: a resposta fica aprovada e o chamado anda
  UPDATE sugestoes SET resposta = v_texto, resposta_aprovada = true, resposta_aprovada_por = v_ceo_user, resposta_aprovada_em = now(),
         status = v_status, confirmado_pelo_autor = false, updated_at = now()
   WHERE id = p_sugestao_id;

  -- a MESMA notificação do caminho normal (tipo 'resposta' → fn_sugestao_email_fila manda o e-mail)
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem, email_status, email_proxima_tentativa)
  VALUES (p_sugestao_id, s.user_id, 'resposta', '#' || s.numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(s.titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.', 'pendente', now())
  RETURNING id INTO v_notif;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg, 'notificacao_id', v_notif, 'status', v_status, 'texto_hash', v_hash);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) TO service_role;
