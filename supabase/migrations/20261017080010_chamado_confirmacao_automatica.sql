-- Confirmação automática de chamados (CEO 16/10 20:30, msg 70a8b35f) — aditiva.
-- Chamado em aguardando_confirmacao: 3 dias úteis sem retorno do cliente => aviso; 2 dias úteis depois do aviso
-- (5 no total) => concluida automática. Resposta do cliente cancela. Cliente reabre em até 30 dias.
-- Dias úteis = seg–sex sem feriado nacional (fn_e_feriado_nacional). Backlog: o 1º ciclo avisa todos; conclui 2 dias úteis depois.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS confirmacao_aviso_em timestamptz,
  ADD COLUMN IF NOT EXISTS confirmacao_limite_em timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_automatico boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

-- soma N dias úteis a uma data (N >= 0)
CREATE OR REPLACE FUNCTION public.fn_somar_dias_uteis(p_data date, p_dias int)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_d date := p_data; v_n int := 0;
BEGIN
  WHILE v_n < GREATEST(p_dias, 0) LOOP
    v_d := v_d + 1;
    IF extract(isodow from v_d) < 6 AND NOT public.fn_e_feriado_nacional(v_d) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_d;
END $$;

-- decisão pura (testável): o que fazer com um chamado em aguardando_confirmacao
-- ref = quando a resposta foi dada; aviso/limite = marcas já gravadas; cliente_respondeu = mensagem do autor depois do aviso
CREATE OR REPLACE FUNCTION public.fn_confirmacao_auto_decidir(
  p_ref timestamptz, p_aviso timestamptz, p_limite timestamptz, p_cliente_respondeu boolean, p_agora timestamptz)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_hoje date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_aviso IS NOT NULL AND p_cliente_respondeu THEN RETURN 'cancelar'; END IF;
  IF p_aviso IS NULL THEN
    IF v_hoje >= public.fn_somar_dias_uteis((p_ref AT TIME ZONE 'America/Sao_Paulo')::date, 3) THEN RETURN 'avisar'; END IF;
    RETURN 'nada';
  END IF;
  IF v_hoje >= (p_limite AT TIME ZONE 'America/Sao_Paulo')::date THEN RETURN 'concluir'; END IF;
  RETURN 'nada';
END $$;

CREATE OR REPLACE FUNCTION public.fn_chamado_confirmacao_automatica()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_dec text; v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
        v_lim timestamptz; v_av int := 0; v_co int := 0; v_ca int := 0; v_resp boolean;
BEGIN
  -- só em dia útil e em horário comercial (BRT)
  IF extract(isodow from v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje)
     OR extract(hour from now() AT TIME ZONE 'America/Sao_Paulo') NOT BETWEEN 8 AND 18 THEN
    RETURN jsonb_build_object('ok', true, 'pulado', 'fora_do_horario_util');
  END IF;
  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.company_id,
           COALESCE(s.resposta_aprovada_em, s.updated_at) AS ref, s.confirmacao_aviso_em, s.confirmacao_limite_em
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND COALESCE(s.confirmado_pelo_autor, false) = false
     LIMIT 500
  LOOP
    v_resp := r.confirmacao_aviso_em IS NOT NULL AND EXISTS (
      SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id = r.id AND m.papel = 'autor' AND m.criado_em > r.confirmacao_aviso_em);
    v_dec := public.fn_confirmacao_auto_decidir(r.ref, r.confirmacao_aviso_em, r.confirmacao_limite_em, v_resp, now());
    IF v_dec = 'avisar' THEN
      v_lim := public.fn_somar_dias_uteis(v_hoje, 2)::timestamp AT TIME ZONE 'America/Sao_Paulo';
      UPDATE sugestoes SET confirmacao_aviso_em = now(), confirmacao_limite_em = v_lim WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, r.user_id, 'ps', 'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.ref AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_lim AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
        || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'aviso_conclusao', '#' || r.numero || ' · Confirme seu chamado: ' || COALESCE(NULLIF(btrim(r.titulo),''), 'sua solicitação'),
        'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.ref AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_lim AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
        || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.');
      v_av := v_av + 1;
    ELSIF v_dec = 'concluir' THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = now(), concluido_automatico = true,
             encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
             encerrado_sem_confirmacao = true, encerrado_em = now(), updated_at = now()
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, r.user_id, 'ps', 'Concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído', 'Concluído automaticamente após 5 dias úteis sem retorno. Se algo não ficou certo, reabra em até 30 dias.');
      v_co := v_co + 1;
    ELSIF v_dec = 'cancelar' THEN
      UPDATE sugestoes SET confirmacao_aviso_em = NULL, confirmacao_limite_em = NULL WHERE id = r.id;
      v_ca := v_ca + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_av, 'concluidos', v_co, 'cancelados', v_ca);
END $$;

-- cliente reabre (autor ou admin) em até 30 dias após a conclusão; volta com prioridade para o Code da carteira
CREATE OR REPLACE FUNCTION public.fn_chamado_reabrir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  SELECT id, user_id, status, concluido_em, numero INTO s FROM sugestoes WHERE id = p_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT (s.user_id = auth.uid() OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF s.status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF s.concluido_em IS NULL OR s.concluido_em < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;
  UPDATE sugestoes SET status = 'em_analise', prioridade = 'alta', reaberto_em = now(), concluido_em = NULL,
         concluido_automatico = false, encerrado_sem_confirmacao = false, confirmacao_aviso_em = NULL,
         confirmacao_limite_em = NULL, confirmado_pelo_autor = false, agente = NULL, em_atendimento_desde = NULL,
         ultimo_movimento = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'autor',
          'Chamado reaberto.' || COALESCE(' Motivo: ' || NULLIF(btrim(p_motivo),''), ''));
  RETURN jsonb_build_object('ok', true, 'status', 'em_analise');
END $$;

REVOKE ALL ON FUNCTION public.fn_chamado_confirmacao_automatica() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chamado_reabrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamado_reabrir(uuid, text) TO authenticated;

-- 12:00 UTC (9h BRT) a 21:00 UTC, seg–sex; a função ainda confere dia útil/feriado/horário
SELECT cron.schedule('chamado-confirmacao-automatica', '0 12,15 * * 1-5', $$SELECT public.fn_chamado_confirmacao_automatica();$$);
