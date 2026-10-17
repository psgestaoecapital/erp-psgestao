-- Chamado #3281 (Gean, piloto; vale para todas as empresas) — relatórios longos em SEGUNDO PLANO. ETAPA 3: aviso quando
-- o relatório termina. Quem pediu recebe:
--   - no SINO (erp_notificacao_usuario, o mesmo aviso "Para você" do #120, que também vai ao celular pelo Web Push):
--     "pronto" ou "não foi possível gerar", com link para Financeiro > Meus relatórios;
--   - por E-MAIL, só quando fica PRONTO, pelo provedor atual (fn_enviar_email, sem custo novo — RD-42). O e-mail leva só o
--     título e a validade; o arquivo continua no bucket privado e só abre na tela, logado (nada de link público).
-- O aviso nasce no banco (gatilho na troca de status gerando → pronto/erro), então vale para o gerador da rota, o pg_cron e
-- qualquer outra porta. Falha no aviso NUNCA desfaz a geração (bloco de exceção). Grava avisado_em (coluna da etapa 1).
-- fn_email_render: CREATE OR REPLACE a partir da definição VIVA (md5 5205b696… = 20261005100000), com TODOS os templates
-- de antes + 'relatorio_pronto' (gate check-agente-chamado-responder confere a última definição).

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
  ELSIF p_template = 'relatorio_pronto' THEN
    -- #3281 etapa 3: aviso de relatório pronto. Só o título e a validade; o arquivo fica na tela (login), nunca no e-mail.
    v_assunto := 'Seu relatório está pronto' || COALESCE(' · ' || v_empresa, '') || ' — PS Gestão';
    v_titulo  := 'Seu relatório está pronto';
    v_corpo   := 'Olá, ' || v_nome || '. O relatório <b>'
                 || replace(replace(replace(COALESCE(NULLIF(btrim(p_dados->>'titulo_relatorio'),''), 'pedido'),'&','&amp;'),'<','&lt;'),'>','&gt;')
                 || '</b>' || COALESCE(' de ' || replace(replace(replace(v_empresa,'&','&amp;'),'<','&lt;'),'>','&gt;'), '')
                 || ' terminou de ser gerado. Ele fica disponível em <b>Financeiro &gt; Meus relatórios</b>'
                 || COALESCE(' até ' || NULLIF(btrim(p_dados->>'expira'),''), ' por 7 dias') || '.';
    v_cta     := 'Abrir Meus relatórios';
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

-- ───────────────────────────── Gatilho do aviso ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_relatorio_pedido_avisar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text; v_nome text; v_empresa text; v_tem_usuario boolean;
BEGIN
  IF NEW.status NOT IN ('pronto','erro') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT true, u.email, COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1))
      INTO v_tem_usuario, v_email, v_nome
      FROM public.users u WHERE u.id = NEW.solicitante;
    SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.razao_social) INTO v_empresa
      FROM public.companies c WHERE c.id = NEW.company_id;

    IF v_tem_usuario THEN
      INSERT INTO public.erp_notificacao_usuario
        (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id)
      VALUES
        (NEW.company_id, NEW.solicitante,
         CASE WHEN NEW.status = 'pronto' THEN 'relatorio_pronto' ELSE 'relatorio_erro' END,
         CASE WHEN NEW.status = 'pronto' THEN 'Relatório pronto · ' ELSE 'Relatório não gerado · ' END || NEW.titulo,
         CASE WHEN NEW.status = 'pronto'
              THEN 'Pronto para baixar' || COALESCE(' até ' || to_char(NEW.expira_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), '') || '.'
              ELSE COALESCE(NEW.erro, 'Não foi possível gerar. Peça de novo.') END,
         '/dashboard/financeiro/meus-relatorios',
         'erp_relatorio_pedido', NEW.id);
    END IF;

    IF NEW.status = 'pronto' AND v_email IS NOT NULL THEN
      PERFORM public.fn_enviar_email(v_email, 'relatorio_pronto', jsonb_build_object(
        'nome', v_nome,
        'empresa', v_empresa,
        'titulo_relatorio', NEW.titulo,
        'expira', to_char(NEW.expira_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
        'link', public.fn_app_base_url() || '/dashboard/financeiro/meus-relatorios',
        'idempotency_key', NEW.id::text,
        'company_id', NEW.company_id));
    END IF;

    NEW.avisado_em := now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_relatorio_pedido_avisar %: %', NEW.id, SQLERRM;   -- o aviso nunca desfaz a geração
  END;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_relatorio_pedido_avisar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_relatorio_pedido_avisar ON public.erp_relatorio_pedido;
CREATE TRIGGER trg_relatorio_pedido_avisar
  BEFORE UPDATE OF status ON public.erp_relatorio_pedido
  FOR EACH ROW EXECUTE FUNCTION public.fn_relatorio_pedido_avisar();
