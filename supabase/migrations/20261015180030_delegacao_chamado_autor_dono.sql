-- DELEGAÇÃO (CEO 14/10 16:00) — a resposta de chamado dada pelo Code de um sócio sai EM NOME DO SÓCIO dono da
-- carteira, não mais sempre em nome do CEO. Hoje o autor é sempre a conta de erp_agente_config.chamado_autor_email.
-- Agora: autor = dono do agente (erp_agente_dono, pelo agente destinatário da mensagem = m.para), quando houver um
-- dono ATIVO e conta PS de verdade; senão, cai na conta PS padrão (chamado_autor_email), como antes.
--
-- Mantém TODAS as travas de "o agente nunca forja identidade" (CEO 04/10): o autor nunca vem de parâmetro; é
-- resolvido no servidor a partir da tabela controlada erp_agente_dono (só canal de serviço grava) e TEM de ser uma
-- conta com system_role PS_ADMIN/PS_ADMIN_CVM. Jordana e Rodrigo são PS_ADMIN → qualificam. O rastro continua
-- completo (redigido_por = agente, ok_ceo_em/origem/registrado_por da mensagem). CREATE OR REPLACE da MESMA
-- assinatura (sem overload); privilégios preservados. Via revisada (núcleo de chamados / identidade).

CREATE OR REPLACE FUNCTION public.fn_agente_chamado_responder(p_mensagem_agente uuid, p_sugestao_id uuid, p_texto text, p_novo_status text DEFAULT NULL::text, p_hash_aprovado text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record; s record; v_autor_email text; v_autor_user uuid; v_msg uuid; v_notif uuid; v_status text; v_hash text; v_texto text := btrim(COALESCE(p_texto,''));
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
  -- Autor: NUNCA vem de parâmetro. 1º o dono ATIVO do agente destinatário (erp_agente_dono, tabela só de serviço);
  -- 2º a conta PS padrão (chamado_autor_email). Em ambos os casos tem de ser PS_ADMIN/PS_ADMIN_CVM de verdade.
  SELECT u.id, u.email INTO v_autor_user, v_autor_email
    FROM erp_agente_dono d JOIN users u ON u.id = d.user_id
   WHERE d.agente = m.para AND d.ativo
     AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')
   LIMIT 1;
  IF v_autor_user IS NULL THEN
    SELECT u.id, u.email INTO v_autor_user, v_autor_email FROM users u
     WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'))
       AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM');
  END IF;
  IF v_autor_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autor_nao_identificado'); END IF;
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
  VALUES (p_sugestao_id, v_autor_user, v_autor_email, 'ps', v_texto, now(),
          m.para, v_autor_user, m.ok_ceo_em, m.id, v_hash, m.ok_ceo_origem, m.ok_registrado_por)
  RETURNING id INTO v_msg;

  -- mesmo efeito de fn_sugestao_aprovar_resposta: a resposta fica aprovada e o chamado anda
  UPDATE sugestoes SET resposta = v_texto, resposta_aprovada = true, resposta_aprovada_por = v_autor_user, resposta_aprovada_em = now(),
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

-- Privilégios reafirmados (CREATE OR REPLACE preserva o ACL; aqui fica explícito também para banco de teste novo):
-- só a conexão de serviço executa — nunca anon/authenticated/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) TO service_role;
