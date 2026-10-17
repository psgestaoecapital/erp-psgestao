-- Confirmação automática de chamados (CEO 16/10 20:30, RD-97 — comportamento novo visível ao cliente, autorizado).
-- Chamado em aguardando_confirmacao: aviso com 3 dias úteis sem retorno; conclusão automática com 5 dias úteis.
-- Backlog: aviso no 1º ciclo, conclusão 2 dias úteis depois. Resposta do autor cancela. Reabrir em até 30 dias.
-- Dias úteis = segunda a sexta, sem feriado nacional (fn_e_feriado_nacional). Aditiva: colunas e funções NOVAS.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_em timestamptz,
  ADD COLUMN IF NOT EXISTS autoconclusao_prevista_em date,
  ADD COLUMN IF NOT EXISTS concluido_automaticamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

-- soma dias úteis (pula sábado, domingo e feriado nacional)
CREATE OR REPLACE FUNCTION public.fn_sugestao_somar_du(p_data date, p_dias integer)
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

-- regra pura dos prazos (testável sem tocar dado): o que fazer com um chamado hoje?
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_regra(p_aprovada_em date, p_hoje date, p_avisado boolean, p_limite date)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE v_aviso date := public.fn_sugestao_somar_du(p_aprovada_em, 3);
        v_limite date;
BEGIN
  IF p_avisado THEN
    IF p_hoje >= COALESCE(p_limite, public.fn_sugestao_somar_du(p_aprovada_em, 5)) THEN
      RETURN jsonb_build_object('acao', 'concluir');
    END IF;
    RETURN jsonb_build_object('acao', 'nada');
  END IF;
  IF p_hoje < v_aviso THEN RETURN jsonb_build_object('acao', 'nada'); END IF;
  -- limite normal = 5 du; backlog (já passou do limite) = 2 du depois do aviso
  v_limite := GREATEST(public.fn_sugestao_somar_du(p_aprovada_em, 5), public.fn_sugestao_somar_du(p_hoje, 2));
  RETURN jsonb_build_object('acao', 'avisar', 'limite', v_limite);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar(p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v jsonb; v_aviso int := 0; v_concl int := 0; v_cancel int := 0; v_limite date;
BEGIN
  -- só em dia útil (horário comercial vem do agendamento)
  IF extract(isodow FROM p_hoje) >= 6 OR public.fn_e_feriado_nacional(p_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util');
  END IF;
  FOR r IN
    SELECT s.id, s.user_id, s.numero, s.titulo, s.resposta_aprovada_em, s.aviso_autoconclusao_em, s.autoconclusao_prevista_em,
           EXISTS (SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id = s.id AND m.papel = 'autor'
                    AND m.criado_em > s.resposta_aprovada_em) AS respondeu
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND s.resposta_aprovada = true
       AND COALESCE(s.confirmado_pelo_autor, false) = false
       AND s.resposta_aprovada_em IS NOT NULL
     LIMIT 500
  LOOP
    IF r.respondeu THEN   -- resposta do cliente cancela
      IF r.aviso_autoconclusao_em IS NOT NULL THEN
        UPDATE sugestoes SET aviso_autoconclusao_em = NULL, autoconclusao_prevista_em = NULL WHERE id = r.id;
        v_cancel := v_cancel + 1;
      END IF;
      CONTINUE;
    END IF;
    v := public.fn_sugestao_autoconfirmar_regra((r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date, p_hoje,
                                                r.aviso_autoconclusao_em IS NOT NULL, r.autoconclusao_prevista_em);
    IF v->>'acao' = 'avisar' THEN
      v_limite := (v->>'limite')::date;
      UPDATE sugestoes SET aviso_autoconclusao_em = now(), autoconclusao_prevista_em = v_limite WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, redigido_por)
      VALUES (r.id, r.user_id, 'ps',
        'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.',
        'sistema');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'resposta',
        '#' || r.numero || ' · Confirme seu chamado: ' || COALESCE(NULLIF(btrim(r.titulo), ''), 'sua solicitação'),
        'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.');
      v_aviso := v_aviso + 1;
    ELSIF v->>'acao' = 'concluir' THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = now(), concluido_automaticamente = true,
             encerrado_sem_confirmacao = true, encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
             encerrado_em = now(), confirmado_pelo_autor = false, updated_at = now()
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, redigido_por)
      VALUES (r.id, r.user_id, 'ps', 'concluído automaticamente após 5 dias úteis sem retorno do cliente', 'sistema');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído',
        'Como não houve retorno, concluímos o chamado #' || r.numero || '. Se algo não ficou certo, você pode reabrir em até 30 dias.');
      v_concl := v_concl + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_aviso, 'concluidos', v_concl, 'cancelados', v_cancel);
END $function$;

-- reabrir em até 30 dias após a conclusão (um clique; volta para o Code da carteira com prioridade alta)
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_status text; v_conc timestamptz; v_numero int;
BEGIN
  SELECT user_id, status, concluido_em, numero INTO v_autor, v_status, v_conc, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_reabre'); END IF;
  IF v_status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF v_conc IS NULL OR v_conc < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_30_dias_vencido'); END IF;
  UPDATE sugestoes SET status = 'em_desenvolvimento', prioridade = 'alta', resposta_aprovada = false,
         confirmado_pelo_autor = false, concluido_em = NULL, concluido_automaticamente = false,
         encerrado_sem_confirmacao = false, aviso_autoconclusao_em = NULL, autoconclusao_prevista_em = NULL,
         reaberto_em = now(), agente = NULL, em_atendimento_desde = NULL, ultimo_movimento = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
  VALUES (p_id, v_autor, 'autor', COALESCE(NULLIF(btrim(p_motivo), ''), 'Reabri o chamado: ainda não ficou resolvido.'));
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', COALESCE(NULLIF(btrim(p_motivo), ''), 'Reaberto após conclusão')
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_autoconfirmar(date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_somar_du(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_somar_du(date, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar_regra(date, date, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_autoconfirmar_regra(date, date, boolean, date) TO authenticated, service_role;

-- diário, horário comercial (09:40 em Brasília = 12:40 UTC), seg–sex; o feriado é checado dentro da função
DO $$
BEGIN
  PERFORM cron.unschedule('sugestao-autoconfirmar-diario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sugestao-autoconfirmar-diario');
  PERFORM cron.schedule('sugestao-autoconfirmar-diario', '40 12 * * 1-5', 'SELECT public.fn_sugestao_autoconfirmar()');
END $$;
