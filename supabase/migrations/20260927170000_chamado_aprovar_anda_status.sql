-- Chamados · APROVAR A RESPOSTA = O CLIENTE RECEBE E O CHAMADO ANDA (CEO 27/09).
-- Defeito provado: fn_sugestao_aprovar_resposta gravava resposta_aprovada=true, a mensagem e a notificação, mas NÃO
-- mexia no status. Chamados resolvidos (#38, #59, #71, #75, #76, #115, #122…) ficavam "nova"/"em desenvolvimento" —
-- para o cliente, parados. E o fluxo nem tinha um status para "esperando o cliente confirmar".
--  1) novo status 'aguardando_confirmacao' (aguardando confirmação do cliente) no fluxo;
--  2) aprovar a resposta leva o chamado aberto para 'aguardando_confirmacao' (terminal fica como está);
--  3) o cliente respondendo no chamado (mensagem) tira de 'aguardando_confirmacao' e devolve para 'em_desenvolvimento'
--     (a bola volta para a PS); "funcionou" continua levando a 'concluida', "não resolveu" a 'em_desenvolvimento';
--  4) acerto do estado atual (decisão do CEO, 27/09): os chamados cuja resposta aprovada é uma ENTREGA passam para
--     'aguardando_confirmacao'. Ficam de fora os que esperam informação do cliente (#55, #56, #64), os que têm só
--     promessa aprovada (#32, #35, #80, #89, #94, #96 — entram quando a nova resposta for aprovada) e o #24
--     (título da MBOX ainda depende do achado C).

ALTER TABLE public.sugestoes DROP CONSTRAINT IF EXISTS sugestoes_status_fluxo_chk;
ALTER TABLE public.sugestoes ADD CONSTRAINT sugestoes_status_fluxo_chk CHECK ((status IS NULL) OR (status = ANY (ARRAY[
  'nova','em_analise','aceita','em_desenvolvimento','aguardando_confirmacao','concluida','recusada','duplicada','arquivada'])));

CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int; v_email text; v_nome text; v_company uuid; v_notif uuid; v_redigida uuid; v_redator_email text; v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero, user_email, user_name, company_id, resposta_redigida_por
    INTO v_autor, v_resp, v_titulo, v_numero, v_email, v_nome, v_company, v_redigida FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;
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

CREATE OR REPLACE FUNCTION public.fn_sugestao_mensagem_enviar(p_sugestao_id uuid, p_user uuid, p_texto text DEFAULT NULL::text, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_autor_chamado uuid; v_company uuid; v_titulo text; v_status text; v_numero int;
  v_papel text; v_msg_id uuid; v_email text; v_an jsonb; v_ord int := 0;
  v_tem_anexo boolean := (p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' AND jsonb_array_length(p_anexos) > 0);
  v_anexo_ids uuid[] := ARRAY[]::uuid[]; v_new_anexo uuid;
BEGIN
  SELECT user_id, company_id, titulo, status, numero INTO v_autor_chamado, v_company, v_titulo, v_status, v_numero
    FROM sugestoes WHERE id = p_sugestao_id;
  IF v_autor_chamado IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  IF auth.uid() = v_autor_chamado THEN v_papel := 'autor';
  ELSIF is_admin() OR fn_pode_ver_fila_suporte() THEN v_papel := 'ps';
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF COALESCE(btrim(p_texto),'') = '' AND NOT v_tem_anexo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_vazia'); END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_sugestao_id, p_user, v_email, v_papel, NULLIF(btrim(p_texto),''))
  RETURNING id INTO v_msg_id;

  IF v_tem_anexo THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (p_sugestao_id, v_msg_id, v_company, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user)
      RETURNING id INTO v_new_anexo;
      v_anexo_ids := v_anexo_ids || v_new_anexo;
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  IF v_papel = 'autor' THEN
    -- o cliente respondeu: a bola volta para a PS (sai de "aguardando confirmação" e reabre o que estava encerrado)
    UPDATE sugestoes SET
      status = CASE WHEN status IN ('concluida','recusada','duplicada','arquivada','aguardando_confirmacao') THEN 'em_desenvolvimento' ELSE status END,
      confirmado_pelo_autor = false, updated_at = now()
    WHERE id = p_sugestao_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_sugestao_id, u.id, 'mensagem',
           '#' || v_numero || ' · Nova mensagem no chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sem título'),
           left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200)
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  ELSE
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    VALUES (p_sugestao_id, v_autor_chamado, 'mensagem',
            '#' || v_numero || ' · Nova mensagem no seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
            left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg_id, 'papel', v_papel,
                            'anexos', to_jsonb(v_anexo_ids), 'tem_foto', v_tem_anexo);
END $function$;

-- envelhecidos sem PR: "aguardando confirmação" não é trabalho parado da PS
CREATE OR REPLACE FUNCTION public.fn_chamados_envelhecidos_sem_pr()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', count(*),
    'itens', COALESCE(jsonb_agg(jsonb_build_object(
        'numero', numero,
        'titulo', left(titulo, 60),
        'autor', user_name,
        'status', status,
        'idade_dias', (now()::date - created_at::date)
      ) ORDER BY created_at), '[]'::jsonb)
  )
  FROM public.sugestoes
  WHERE status IN ('nova', 'em_desenvolvimento')
    AND pr_numero IS NULL
    AND resposta IS NOT NULL AND btrim(resposta) <> ''
    AND created_at < now() - INTERVAL '7 days';
$function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_aprovar_resposta(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_aprovar_resposta(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_chamados_envelhecidos_sem_pr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_envelhecidos_sem_pr() TO authenticated, service_role;

-- 4) acerto do estado atual: resposta aprovada = entrega, ainda sem confirmação do cliente.
UPDATE public.sugestoes
   SET status = 'aguardando_confirmacao', updated_at = now()
 WHERE numero IN (21, 22, 23, 26, 38, 39, 40, 41, 48, 49, 53, 57, 59, 71, 75, 76, 77, 86, 101, 114, 115, 122, 138, 139, 140, 141, 143)
   AND resposta_aprovada = true
   AND COALESCE(confirmado_pelo_autor, false) = false
   AND status IN ('nova', 'em_analise', 'aceita', 'em_desenvolvimento');
