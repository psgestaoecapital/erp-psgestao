-- ============================================================
-- Chamados · Encerramento SEM confirmação do autor (decisão do CEO, não automático)
-- ============================================================
-- Nó de DESENHO (auditoria do CEO): fn_sugestao_confirmar só o AUTOR fecha; ninguém é avisado
-- (Resend fora), então chamado resolvido fica aberto para sempre porque o autor sumiu. 14 aprovados,
-- zero confirmados. Precisa existir uma saída — mas é DECISÃO do CEO, nunca automática.
--
-- Regra: só encerra o que está REALMENTE parado esperando o autor — resposta aprovada há mais de 7 dias
-- e ainda não confirmada. Registra que foi encerrado SEM confirmação (honestidade/trilha — RD-30/RD-55):
-- não finge que o autor confirmou. Guarda motivo, quem e quando; deixa trilha na conversa e avisa o autor.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS encerrado_sem_confirmacao boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS encerramento_motivo text,
  ADD COLUMN IF NOT EXISTS encerrado_por uuid,
  ADD COLUMN IF NOT EXISTS encerrado_em timestamptz;
COMMENT ON COLUMN public.sugestoes.encerrado_sem_confirmacao IS
  'true = concluída por decisão do PS/CEO sem o autor ter confirmado (autor sumiu). Não é o mesmo que confirmado_pelo_autor.';

CREATE OR REPLACE FUNCTION public.fn_sugestao_encerrar_sem_confirmacao(p_id uuid, p_user uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_conf boolean; v_status text; v_aprov_em timestamptz; v_numero int; v_titulo text;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  SELECT user_id, resposta_aprovada, confirmado_pelo_autor, status, resposta_aprovada_em, numero, titulo
    INTO v_autor, v_aprovada, v_conf, v_status, v_aprov_em, v_numero, v_titulo
    FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF v_status = 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_concluida'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_aprovada'); END IF;  -- só o que já foi respondido/aprovado
  IF COALESCE(v_conf, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_confirmado'); END IF;
  IF v_aprov_em IS NULL OR v_aprov_em > now() - interval '7 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ainda_no_prazo',
      'aprovada_em', v_aprov_em, 'libera_em', v_aprov_em + interval '7 days'); END IF;

  UPDATE sugestoes SET
    status = 'concluida', concluido_em = now(),
    encerrado_sem_confirmacao = true, encerramento_motivo = btrim(p_motivo),
    encerrado_por = p_user, encerrado_em = now(),
    confirmado_pelo_autor = false,   -- honesto: NÃO foi o autor que confirmou
    atendente_id = COALESCE(atendente_id, p_user), updated_at = now()
  WHERE id = p_id;

  -- trilha na conversa + aviso ao autor (não finge confirmação)
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_id, p_user, (SELECT email FROM users WHERE id = p_user), 'ps',
          'Chamado encerrado sem confirmação do autor (mais de 7 dias sem resposta). Motivo: ' || btrim(p_motivo));
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'encerrado',
          '#' || v_numero || ' · Chamado encerrado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe encerrou o chamado após mais de 7 dias sem sua confirmação. Se ainda não resolveu, reabra respondendo na Central de Melhorias. Motivo: ' || btrim(p_motivo));

  RETURN jsonb_build_object('ok', true, 'status', 'concluida', 'encerrado_sem_confirmacao', true);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_sugestao_encerrar_sem_confirmacao(uuid, uuid, text) TO authenticated;
