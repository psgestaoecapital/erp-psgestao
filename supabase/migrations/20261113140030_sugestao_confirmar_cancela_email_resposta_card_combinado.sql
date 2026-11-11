-- #7050 (AJUSTE) — Não enviar o e-mail "Respondemos seu chamado" no card combinado (operador = autor).
--
-- PROBLEMA: no card combinado "Aprovar e confirmar que funcionou/não funcionou" (Central de
-- Melhorias › Precisa de você, quando o operador é o próprio autor), um clique roda dois passos:
--   1) fn_sugestao_aprovar_resposta: resposta_aprovada=true, status→aguardando_confirmacao e
--      INSERE sugestao_notificacao tipo='resposta' (email_status='pendente') → enfileira o e-mail
--      template 'chamado_resposta' ("Respondemos seu chamado").
--   2) fn_sugestao_confirmar: fecha o chamado (status=concluida / reabre).
-- O cron fn_sugestao_email_fila envia ~1 min depois, para um chamado JÁ confirmado pelo autor.
-- PROVA (RD-38): #5622, #5659, #5661, #5671, #5680, #5684, #6876, #6884 — concluídos 11/11 e o
-- e-mail de 'resposta' saiu 30-45s DEPOIS do concluido_em (email_enviado_em > concluido_em).
--
-- CORREÇÃO (aditiva, sem tocar RLS/permissões):
--   A) Em fn_sugestao_confirmar (os 2 overloads): quando o autor confirma (funcionou OU não
--      funcionou), CANCELA a notificação 'resposta' daquele chamado ainda não enviada
--      (email_enviado_em IS NULL AND email_status='pendente') → email_status='cancelado'.
--   B) Defesa contra a corrida em fn_sugestao_email_fila: não envia o e-mail de 'resposta'
--      quando o chamado já está CONCLUÍDO/CONFIRMADO pelo autor.
-- FLUXO NORMAL PRESERVADO: quando o autor é OUTRA pessoa, no momento do envio o chamado está em
-- 'aguardando_confirmacao' (não confirmado) e o e-mail continua saindo na aprovação.

-- ============================================================================================
-- A1) fn_sugestao_confirmar(uuid,uuid,boolean,text,jsonb) — overload com anexos (atual)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL::text, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_numero int; v_company uuid; v_msg_id uuid;
BEGIN
  SELECT user_id, resposta_aprovada, numero, company_id
    INTO v_autor, v_aprovada, v_numero, v_company FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_confirma'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_aprovada'); END IF;

  -- #7050: ao confirmar (funcionou OU não), cancela o e-mail "Respondemos seu chamado" ainda na fila
  -- (card combinado operador=autor). O cron não enviará notificação cancelada.
  UPDATE sugestao_notificacao
     SET email_status = 'cancelado'
   WHERE sugestao_id = p_id AND tipo = 'resposta'
     AND email_enviado_em IS NULL AND email_status = 'pendente';

  IF p_funcionou THEN
    UPDATE sugestoes SET confirmado_pelo_autor = true, confirmado_em = now(),
      status = 'concluida', concluido_em = now(), updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'concluida');
  ELSE
    IF COALESCE(btrim(p_motivo),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
    UPDATE sugestoes SET confirmado_pelo_autor = false, status = 'em_desenvolvimento',
      resposta_aprovada = false, updated_at = now() WHERE id = p_id;
    -- devolutiva na thread (papel='autor')
    INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em)
    VALUES (p_id, v_autor, 'autor', btrim(p_motivo), now())
    RETURNING id INTO v_msg_id;
    -- #2 fast-follow · anexa as fotos à mensagem da devolutiva (se houver)
    IF jsonb_typeof(COALESCE(p_anexos,'[]'::jsonb)) = 'array' AND jsonb_array_length(COALESCE(p_anexos,'[]'::jsonb)) > 0 THEN
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, marcacoes, ordem, created_by, tipo)
      SELECT p_id, v_msg_id, v_company, a->>'storage_path',
             COALESCE(a->'marcacoes','[]'::jsonb), (ord-1)::int, v_autor, 'imagem'
      FROM jsonb_array_elements(p_anexos) WITH ORDINALITY AS t(a, ord)
      WHERE COALESCE(a->>'storage_path','') <> '';
    END IF;
    -- notificação aos PS admins (inalterada)
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true, 'mensagem_id', v_msg_id);
  END IF;
END $function$;

-- ============================================================================================
-- A2) fn_sugestao_confirmar(uuid,uuid,boolean,text) — overload legado (sem anexos)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_numero int;
BEGIN
  SELECT user_id, resposta_aprovada, numero INTO v_autor, v_aprovada, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_confirma'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_aprovada'); END IF;

  -- #7050: ao confirmar (funcionou OU não), cancela o e-mail "Respondemos seu chamado" ainda na fila
  UPDATE sugestao_notificacao
     SET email_status = 'cancelado'
   WHERE sugestao_id = p_id AND tipo = 'resposta'
     AND email_enviado_em IS NULL AND email_status = 'pendente';

  IF p_funcionou THEN
    UPDATE sugestoes SET confirmado_pelo_autor = true, confirmado_em = now(),
      status = 'concluida', concluido_em = now(), updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'concluida');
  ELSE
    IF COALESCE(btrim(p_motivo),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
    UPDATE sugestoes SET confirmado_pelo_autor = false, status = 'em_desenvolvimento',
      resposta_aprovada = false,
      updated_at = now() WHERE id = p_id;
    -- #2 · a devolutiva ENTRA na thread (não some mais). papel='autor'.
    INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em)
    VALUES (p_id, v_autor, 'autor', btrim(p_motivo), now());
    -- (mantém a notificação aos PS admins)
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
  END IF;
END $function$;

-- ============================================================================================
-- B) fn_sugestao_email_fila(integer) — defesa contra a corrida: não envia 'resposta' se o chamado
--    já está CONCLUÍDO/CONFIRMADO pelo autor (ex.: card combinado). Resto inalterado.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_sugestao_email_fila(p_max integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  r record; v_mail jsonb; v_enviados int := 0; v_falhas int := 0; v_reabertos int := 0; v_max_tentativas int := 6;
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR EXISTS (SELECT 1 FROM users WHERE id=auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Só PS_ADMIN/cron processa a fila de e-mail' USING errcode='42501'; END IF;
  PERFORM public.fn_email_reconciliar(200);
  FOR r IN SELECT n.id, n.email_tentativas, l.erro FROM sugestao_notificacao n JOIN erp_email_log l ON l.id=n.email_log_id
     WHERE n.tipo='resposta' AND n.email_status='enviado' AND l.status='erro' LOOP
    IF r.email_tentativas + 1 >= v_max_tentativas THEN
      UPDATE sugestao_notificacao SET email_status='falhou', email_enviado_em=NULL, email_tentativas=r.email_tentativas+1, email_ultimo_erro=left(coalesce(r.erro,'erro provedor'),500) WHERE id=r.id;
    ELSE
      UPDATE sugestao_notificacao SET email_status='pendente', email_enviado_em=NULL, email_tentativas=r.email_tentativas+1, email_ultimo_erro=left(coalesce(r.erro,'erro provedor'),500),
        email_proxima_tentativa=now()+(CASE r.email_tentativas WHEN 0 THEN interval '2 min' WHEN 1 THEN interval '5 min' WHEN 2 THEN interval '15 min' WHEN 3 THEN interval '30 min' ELSE interval '60 min' END) WHERE id=r.id;
    END IF;
    v_reabertos := v_reabertos + 1;
  END LOOP;
  FOR r IN SELECT n.id AS notif_id, s.id AS sugestao_id, s.user_email, s.user_name, s.numero, s.titulo, s.resposta, s.company_id, n.email_tentativas
      FROM sugestao_notificacao n JOIN sugestoes s ON s.id=n.sugestao_id
     WHERE n.tipo='resposta' AND n.email_enviado_em IS NULL AND n.email_status='pendente'
       AND (n.email_proxima_tentativa IS NULL OR n.email_proxima_tentativa<=now())
       AND s.user_email IS NOT NULL AND position('@' in s.user_email)>0 AND coalesce(btrim(s.resposta),'')<>''
       -- #7050: não envia o "Respondemos seu chamado" se o autor já confirmou/concluiu (card combinado)
       AND COALESCE(s.confirmado_pelo_autor, false) = false
       AND s.status <> 'concluida'
     ORDER BY n.criado_em LIMIT GREATEST(1, LEAST(p_max,50)) LOOP
    v_mail := public.fn_enviar_email(r.user_email, 'chamado_resposta', jsonb_build_object(
      'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', r.resposta,
      'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
      'idempotency_key', 'chamado-resp-' || r.sugestao_id::text, 'company_id', r.company_id));
    IF COALESCE((v_mail->>'ok')::boolean, false) THEN
      UPDATE sugestao_notificacao SET email_enviado_em=now(), email_status='enviado', email_log_id=NULLIF(v_mail->>'email_id','')::uuid, email_ultimo_erro=NULL WHERE id=r.notif_id;
      v_enviados := v_enviados + 1;
    ELSE
      IF r.email_tentativas + 1 >= v_max_tentativas THEN
        UPDATE sugestao_notificacao SET email_status='falhou', email_tentativas=r.email_tentativas+1, email_ultimo_erro=left(coalesce(v_mail->>'erro','falha'),500) WHERE id=r.notif_id;
      ELSE
        UPDATE sugestao_notificacao SET email_tentativas=r.email_tentativas+1, email_ultimo_erro=left(coalesce(v_mail->>'erro','falha'),500),
          email_proxima_tentativa=now()+(CASE r.email_tentativas WHEN 0 THEN interval '2 min' WHEN 1 THEN interval '5 min' WHEN 2 THEN interval '15 min' WHEN 3 THEN interval '30 min' ELSE interval '60 min' END) WHERE id=r.notif_id;
      END IF;
      v_falhas := v_falhas + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'enviados', v_enviados, 'falhas_agora', v_falhas, 'reabertos', v_reabertos,
    'pendentes_restantes', (SELECT count(*) FROM sugestao_notificacao WHERE tipo='resposta' AND email_enviado_em IS NULL AND email_status='pendente'),
    'falhou_total', (SELECT count(*) FROM sugestao_notificacao WHERE tipo='resposta' AND email_status='falhou'));
END; $function$;
