-- Confirmação automática de chamado (CEO 16/10 20:30, RD-97 — mudança que o cliente vê, autorizada).
-- Chamado em aguardando_confirmacao:
--   · 3 dias úteis sem resposta do cliente  → aviso (mensagem na conversa + notificação) com a data limite;
--   · 5 dias úteis sem resposta             → conclui sozinho (concluida), com o motivo no histórico;
--   · backlog: no 1º ciclo todos recebem o aviso e concluem 2 dias úteis depois (limite = o maior entre
--     "resolvido + 5 dias úteis" e "aviso + 2 dias úteis" — vale igual para o caso normal);
--   · qualquer mensagem do cliente depois da resolução cancela (não avisa nem conclui);
--   · o cliente reabre em até 30 dias depois de concluído, com um clique (fn_sugestao_reabrir).
-- Dias úteis = segunda a sexta sem feriado nacional (fn_e_feriado_nacional). Só roda em dia útil, 08:00 BRT.
-- Nada é apagado. Chamado de empresa demo e outros status não são tocados.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS confirmacao_aviso_em   timestamptz,
  ADD COLUMN IF NOT EXISTS confirmacao_limite     date,
  ADD COLUMN IF NOT EXISTS concluido_automatico   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em            timestamptz;

CREATE OR REPLACE FUNCTION public.fn__dias_uteis_somar(p_data date, p_dias integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE d date := p_data; n integer := 0;
BEGIN
  WHILE n < GREATEST(p_dias, 0) LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $function$;

-- dias úteis em (p_de, p_ate]
CREATE OR REPLACE FUNCTION public.fn__dias_uteis_entre(p_de date, p_ate date)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE d date := p_de; n integer := 0;
BEGIN
  WHILE d < p_ate LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_chamado_confirmacao_automatica(p_agora timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  r record; v_base_ts timestamptz; v_base date; v_ult_autor timestamptz; v_limite date;
  v_avisados int := 0; v_concluidos int := 0; v_cancelados int := 0; v_ps uuid;
BEGIN
  IF extract(isodow FROM v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util');
  END IF;

  -- autor das mensagens do sistema = a conta PS configurada (mesma do fn_agente_chamado_responder)
  SELECT u.id INTO v_ps FROM users u
   WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'));
  IF v_ps IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'conta_ps_nao_configurada'); END IF;

  FOR r IN
    SELECT s.id, s.numero, s.user_id, s.titulo, s.resposta_aprovada_em, s.updated_at,
           s.confirmacao_aviso_em, s.confirmacao_limite
      FROM sugestoes s
      LEFT JOIN companies c ON c.id = s.company_id
     WHERE s.status = 'aguardando_confirmacao'
       AND COALESCE(c.is_demo, false) = false
       AND s.user_id IS NOT NULL
     ORDER BY s.created_at
  LOOP
    v_base_ts := COALESCE(r.resposta_aprovada_em, r.updated_at);
    v_base := (v_base_ts AT TIME ZONE 'America/Sao_Paulo')::date;
    SELECT max(m.criado_em) INTO v_ult_autor FROM sugestao_mensagem m WHERE m.sugestao_id = r.id AND m.papel = 'autor';

    -- o cliente respondeu depois da resolução: cancela (e zera um aviso já dado)
    IF v_ult_autor IS NOT NULL AND v_ult_autor > v_base_ts THEN
      IF r.confirmacao_aviso_em IS NOT NULL THEN
        UPDATE sugestoes SET confirmacao_aviso_em = NULL, confirmacao_limite = NULL WHERE id = r.id;
        v_cancelados := v_cancelados + 1;
      END IF;
      CONTINUE;
    END IF;

    IF r.confirmacao_aviso_em IS NULL THEN
      IF public.fn__dias_uteis_entre(v_base, v_hoje) >= 3 THEN
        v_limite := GREATEST(public.fn__dias_uteis_somar(v_base, 5), public.fn__dias_uteis_somar(v_hoje, 2));
        INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
        VALUES (r.id, v_ps, 'sistema@psgestao', 'ps',
          'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(v_base, 'DD/MM/YYYY') ||
          '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') ||
          ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.', 'sistema');
        INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
        VALUES (r.id, r.user_id, 'aviso_confirmacao', '#' || r.numero || ' · Seu chamado foi resolvido',
          'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(v_base, 'DD/MM/YYYY') ||
          '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') ||
          ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.');
        UPDATE sugestoes SET confirmacao_aviso_em = p_agora, confirmacao_limite = v_limite WHERE id = r.id;
        v_avisados := v_avisados + 1;
      END IF;
    ELSIF v_hoje >= r.confirmacao_limite THEN
      UPDATE sugestoes SET
        status = 'concluida', concluido_em = p_agora, concluido_automatico = true,
        encerrado_sem_confirmacao = true, encerrado_em = p_agora,
        encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
        confirmado_pelo_autor = false
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
      VALUES (r.id, v_ps, 'sistema@psgestao', 'ps',
        'Concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.', 'sistema');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído',
        'Seu chamado #' || r.numero || ' foi concluído automaticamente por falta de retorno. Se algo não ficou certo, reabra em até 30 dias pelo próprio chamado.');
      v_concluidos := v_concluidos + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos, 'cancelados', v_cancelados);
END $function$;

-- Reabrir: só o autor, até 30 dias depois de concluído; volta para a fila do Code responsável com prioridade.
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_status text; v_conc timestamptz; v_numero int; v_texto text;
BEGIN
  SELECT user_id, status, concluido_em, numero INTO v_autor, v_status, v_conc, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() IS DISTINCT FROM v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_reabre'); END IF;
  IF v_status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF v_conc IS NULL OR v_conc < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;
  v_texto := COALESCE(NULLIF(btrim(p_motivo), ''), 'Reaberto pelo cliente.');

  UPDATE sugestoes SET
    status = 'em_desenvolvimento', prioridade = 'alta', concluido_em = NULL, concluido_automatico = false,
    encerrado_sem_confirmacao = false, confirmado_pelo_autor = false, resposta_aprovada = false,
    confirmacao_aviso_em = NULL, confirmacao_limite = NULL, reaberto_em = now(),
    atendente_id = NULL, agente = NULL, em_atendimento_desde = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em)
  VALUES (p_id, v_autor, 'autor', v_texto, now());
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', v_texto
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn__dias_uteis_somar(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__dias_uteis_entre(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chamado_confirmacao_automatica(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid, text) TO authenticated;

-- 08:00 BRT (11:00 UTC), segunda a sexta; a função ainda confere feriado.
SELECT cron.schedule('chamado-confirmacao-automatica', '0 11 * * 1-5',
  $$SELECT public.fn_chamado_confirmacao_automatica();$$);
