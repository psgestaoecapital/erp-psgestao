-- Chamados · resposta velha não volta como "rascunho" nem é reenviada (defeito achado no #297, CEO 01/10).
-- O que acontecia: o cliente responde ("ainda não resolveu" ou mensagem na conversa) → fn_sugestao_confirmar desmarcava
-- "aprovada" mas DEIXAVA o texto da resposta já enviada no campo de rascunho. A fila mostrava esse texto velho como
-- "Resposta redigida — esperando você" com "Aprovar e enviar"; aprovar reenviava a mesma resposta e o chamado ia para
-- "aguardando confirmação" sem resposta nova (#297, #116, #339, #587 às 15:07 de 01/10). Pela conversa (fn_sugestao_
-- mensagem_enviar) era pior: "aprovada" nem era desmarcada e o card seguia "esperando o autor".
-- Regra (CEO): mensagem do autor NUNCA leva a "aguardando confirmação" sem resposta NOVA aprovada.
--  1) toda mensagem do autor tira do campo de rascunho a resposta que JÁ ESTÁ na conversa (o texto continua na
--     thread — nada é apagado, RD-30) e desmarca "aprovada": o chamado volta para a PS sem rascunho → "Responder".
--  2) aprovar recusa uma resposta que já foi enviada antes da última mensagem do autor.

-- ci-sem-guarda: fn__sugestao_autor_respondeu — função de gatilho (sem parâmetros); só roda no INSERT de sugestao_mensagem feito pelas funções já guardadas
CREATE OR REPLACE FUNCTION public.fn__sugestao_autor_respondeu()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.papel = 'autor' THEN
    UPDATE sugestoes s SET
      resposta = CASE WHEN EXISTS (SELECT 1 FROM sugestao_mensagem m
                                    WHERE m.sugestao_id = s.id AND m.papel = 'ps' AND btrim(m.texto) = btrim(s.resposta))
                      THEN NULL ELSE s.resposta END,
      resposta_aprovada = false,
      updated_at = now()
     WHERE s.id = NEW.sugestao_id;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn__sugestao_autor_respondeu() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sugestao_autor_respondeu ON public.sugestao_mensagem;
CREATE TRIGGER trg_sugestao_autor_respondeu AFTER INSERT ON public.sugestao_mensagem
  FOR EACH ROW WHEN (NEW.papel = 'autor') EXECUTE FUNCTION public.fn__sugestao_autor_respondeu();

-- aprovar: mesma função de antes + recusa resposta já enviada antes da última mensagem do autor
-- ci-sem-guarda: fn_sugestao_aprovar_resposta — só PS_ADMIN/PS_ADMIN_CVM aprova (conferido no início); a fila de chamados é de todas as empresas
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int; v_email text; v_nome text; v_company uuid; v_notif uuid; v_redigida uuid; v_redator_email text; v_status text;
  v_enviada_em timestamptz; v_ult_autor timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id, resposta_redigida_por
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company, v_redigida FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;
  -- resposta velha: o mesmo texto já foi enviado e o autor escreveu depois → precisa de resposta NOVA
  SELECT max(m.criado_em) INTO v_enviada_em FROM sugestao_mensagem m
   WHERE m.sugestao_id = p_id AND m.papel = 'ps' AND btrim(m.texto) = btrim(v_resp);
  SELECT max(m.criado_em) INTO v_ult_autor FROM sugestao_mensagem m WHERE m.sugestao_id = p_id AND m.papel = 'autor';
  IF v_enviada_em IS NOT NULL AND v_ult_autor IS NOT NULL AND v_ult_autor > v_enviada_em THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_ja_enviada',
      'mensagem', 'Esta resposta já foi enviada e o cliente escreveu depois. Escreva uma resposta nova para a última mensagem dele.');
  END IF;
  -- aprovar = o cliente recebe E o chamado anda: aberto → aguardando a confirmação do cliente.
  -- autoria da aprovação = quem está logado (auth.uid()), nunca o p_user vindo do cliente.
  UPDATE sugestoes SET resposta_aprovada=true, resposta_aprovada_por=auth.uid(), resposta_aprovada_em=now(),
         status = CASE WHEN status IN ('nova','em_analise','aceita','em_desenvolvimento') OR status IS NULL
                       THEN 'aguardando_confirmacao' ELSE status END,
         confirmado_pelo_autor = false,
         updated_at=now()
   WHERE id = p_id
  RETURNING status INTO v_status;
  SELECT email INTO v_redator_email FROM users WHERE id = COALESCE(v_redigida, auth.uid());
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
  SELECT p_id, COALESCE(v_redigida, auth.uid()), v_redator_email, 'ps', v_resp, now()
  WHERE NOT EXISTS (SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id=p_id AND m.papel='ps' AND btrim(m.texto)=btrim(v_resp));
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem, email_status, email_proxima_tentativa)
  VALUES (p_id, v_autor, 'resposta', '#' || v_numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.', 'pendente', now())
  RETURNING id INTO v_notif;
  RETURN jsonb_build_object('ok', true, 'notificado', v_autor, 'email_enfileirado', true, 'status', v_status);
END $function$;
REVOKE ALL ON FUNCTION public.fn_sugestao_aprovar_resposta(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_aprovar_resposta(uuid, uuid) TO authenticated, service_role;
