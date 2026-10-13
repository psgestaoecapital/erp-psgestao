-- E-mail-resumo dos avisos de chamado que não saíram (CEO 04/10, opção A): UM e-mail por pessoa, nunca reenvio um a um.
-- Auditoria (RD-38, no dado): dos 548 avisos 'resposta' em falhou nos últimos 8 dias, 471 são da conta-robô
-- (users.is_robo) e só 54 (a partir de 28/09) são de pessoas reais ativas com e-mail, 15 destinatários.
-- Aditivo (RD-55): o status novo 'resumido' marca os avisos cobertos; nada é apagado. O fn_email_render segue com TODOS os
-- templates (gate check-agente-chamado-responder) + 'chamado_resumo'. Só a conexão de serviço executa (fn__agente_assert_servico).

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
  v_resp text; v_itens text; v_total int; v_lista jsonb;
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
  ELSIF p_template = 'chamado_resumo' THEN
    -- e-mail-resumo dos avisos atrasados (CEO 04/10): só número e título, nunca o texto das respostas
    v_lista := CASE WHEN jsonb_typeof(p_dados->'itens') = 'array' THEN p_dados->'itens' ELSE '[]'::jsonb END;
    v_total := COALESCE(NULLIF(p_dados->>'total','')::int, jsonb_array_length(v_lista));
    SELECT COALESCE(string_agg('#' || COALESCE(i->>'numero','') || ' · ' ||
             replace(replace(replace(COALESCE(i->>'titulo',''),'&','&amp;'),'<','&lt;'),'>','&gt;'), '<br>' ORDER BY ord), '')
      INTO v_itens FROM (SELECT i, ord FROM jsonb_array_elements(v_lista) WITH ORDINALITY t(i, ord) ORDER BY ord LIMIT 10) q;
    v_assunto := 'Você tem respostas novas nos seus chamados';
    v_titulo  := 'Respostas novas nos seus chamados';
    v_corpo   := 'Olá, ' || v_nome || '. Há ' || v_total || ' atualizações nos seus chamados no PS Gestão:<br><br>' || v_itens
                 || CASE WHEN v_total > 10 THEN '<br>e mais ' || (v_total - 10) ELSE '' END;
    v_cta     := 'Abrir meus chamados';
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

-- ci-sem-guarda: fn_chamado_resumo_atrasados_previa — só a conexão de serviço (fn__agente_assert_servico)
-- elegíveis: tipo resposta em 'falhou', dentro da janela, destinatário humano ativo com e-mail
CREATE OR REPLACE FUNCTION public.fn_chamado_resumo_atrasados_previa(p_corte timestamptz DEFAULT '2026-09-28 03:00+00', p_dias int DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT jsonb_build_object('ok', true,
     'avisos_falhou_janela', (SELECT count(*) FROM sugestao_notificacao WHERE tipo='resposta' AND email_status='falhou' AND criado_em > now() - make_interval(days => p_dias)),
     'pessoas', count(*), 'avisos', COALESCE(sum(avisos),0), 'pessoas_lista', COALESCE(jsonb_agg(jsonb_build_object('email', email, 'nome', nome, 'avisos', avisos, 'chamados', chamados) ORDER BY avisos DESC), '[]'::jsonb))
    INTO v
    FROM (SELECT u.email, u.full_name AS nome, count(*) AS avisos, count(DISTINCT n.sugestao_id) AS chamados
            FROM sugestao_notificacao n JOIN users u ON u.id = n.destinatario_id
           WHERE n.tipo='resposta' AND n.email_status='falhou' AND n.criado_em >= p_corte AND n.criado_em > now() - make_interval(days => p_dias)
             AND COALESCE(u.is_active,false) AND NOT COALESCE(u.is_robo,false) AND position('@' in COALESCE(u.email,'')) > 0
           GROUP BY u.id, u.email, u.full_name) q;
  RETURN v;
END; $function$;

-- ci-sem-guarda: fn_chamado_resumo_atrasados_enviar — só a conexão de serviço (fn__agente_assert_servico)
-- envia o resumo (idempotente: só pega 'falhou'; o que sai vira 'resumido'; idempotency_key por pessoa)
CREATE OR REPLACE FUNCTION public.fn_chamado_resumo_atrasados_enviar(p_somente_email text DEFAULT NULL, p_corte timestamptz DEFAULT '2026-09-28 03:00+00', p_dias int DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_itens jsonb; v_total int; v_mail jsonb; v_env int := 0; v_fal int := 0; v_res jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  FOR r IN SELECT u.id AS uid, u.email, COALESCE(NULLIF(btrim(u.full_name),''), 'você') AS nome, min(s.company_id::text)::uuid AS company_id
             FROM sugestao_notificacao n JOIN users u ON u.id = n.destinatario_id JOIN sugestoes s ON s.id = n.sugestao_id
            WHERE n.tipo='resposta' AND n.email_status='falhou' AND n.criado_em >= p_corte AND n.criado_em > now() - make_interval(days => p_dias)
              AND COALESCE(u.is_active,false) AND NOT COALESCE(u.is_robo,false) AND position('@' in COALESCE(u.email,'')) > 0
              AND (p_somente_email IS NULL OR lower(u.email) = lower(p_somente_email))
            GROUP BY u.id, u.email, u.full_name ORDER BY u.email LOOP
    SELECT jsonb_agg(jsonb_build_object('numero', numero, 'titulo', titulo) ORDER BY numero), count(*) INTO v_itens, v_total
      FROM (SELECT DISTINCT s.numero, COALESCE(NULLIF(btrim(s.titulo),''),'(sem título)') AS titulo
              FROM sugestao_notificacao n JOIN sugestoes s ON s.id = n.sugestao_id
             WHERE n.destinatario_id = r.uid AND n.tipo='resposta' AND n.email_status='falhou' AND n.criado_em >= p_corte AND n.criado_em > now() - make_interval(days => p_dias)) q;
    v_mail := public.fn_enviar_email(r.email, 'chamado_resumo', jsonb_build_object(
      'nome', r.nome, 'itens', v_itens, 'total', v_total, 'link', public.fn_app_base_url() || '/dashboard/melhorias',
      'idempotency_key', 'chamado-resumo-atrasados-20261004-' || r.uid::text, 'company_id', r.company_id));
    IF COALESCE((v_mail->>'ok')::boolean, false) THEN
      UPDATE sugestao_notificacao SET email_status='resumido', email_enviado_em=now(), email_log_id=NULLIF(v_mail->>'email_id','')::uuid, email_ultimo_erro=NULL
       WHERE destinatario_id = r.uid AND tipo='resposta' AND email_status='falhou' AND criado_em >= p_corte AND criado_em > now() - make_interval(days => p_dias);
      v_env := v_env + 1;
    ELSE v_fal := v_fal + 1; END IF;
    v_res := v_res || jsonb_build_object('email', r.email, 'chamados', v_total, 'ok', COALESCE((v_mail->>'ok')::boolean,false), 'email_id', v_mail->>'email_id', 'erro', v_mail->>'erro');
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'enviados', v_env, 'falhas', v_fal, 'detalhe', v_res);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_chamado_resumo_atrasados_previa(timestamptz, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chamado_resumo_atrasados_enviar(text, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_resumo_atrasados_previa(timestamptz, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_chamado_resumo_atrasados_enviar(text, timestamptz, int) TO service_role;
