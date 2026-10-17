-- CEO 16/10 20:30 · confirmação automática de chamados (RD-97: comportamento novo visível ao cliente, autorizado pelo CEO).
-- Chamado em aguardando_confirmacao: aviso com 3 dias úteis sem resposta do cliente; conclusão automática com 5 dias úteis
-- (backlog: aviso no 1º ciclo e conclusão 2 dias úteis depois). Resposta do cliente cancela. Cliente reabre em até 30 dias.
-- Dia útil = segunda a sexta, sem feriado nacional (fn_e_feriado_nacional). Prazos contados no fuso America/Sao_Paulo.
-- ADITIVA: colunas e funções NOVAS; nenhuma função existente é reescrita. Só mexe em chamados aguardando_confirmacao.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_em timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_automaticamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

-- n-ésimo dia útil depois de p_data (p_data não conta).
CREATE OR REPLACE FUNCTION public.fn_sugestao_dia_util_apos(p_data date, p_dias integer)
RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE d date := p_data; n integer := 0;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  WHILE n < GREATEST(COALESCE(p_dias, 0), 0) LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- Decisão pura (testável): 'aguardar' | 'avisar' | 'concluir' | 'cancelar' (resposta do cliente depois do aviso).
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_decisao(
  p_resposta_em timestamptz, p_aviso_em timestamptz, p_cliente_respondeu boolean, p_agora timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_hoje date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ref date := (p_resposta_em AT TIME ZONE 'America/Sao_Paulo')::date;
  v_limite date;
BEGIN
  IF p_cliente_respondeu THEN
    RETURN CASE WHEN p_aviso_em IS NOT NULL THEN 'cancelar' ELSE 'aguardar' END;
  END IF;
  IF p_resposta_em IS NULL THEN RETURN 'aguardar'; END IF;
  -- só age em dia útil (horário comercial: o cron roda 08h de Brasília)
  IF extract(isodow FROM v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje) THEN RETURN 'aguardar'; END IF;
  IF p_aviso_em IS NULL THEN
    RETURN CASE WHEN v_hoje >= public.fn_sugestao_dia_util_apos(v_ref, 3) THEN 'avisar' ELSE 'aguardar' END;
  END IF;
  v_limite := GREATEST(public.fn_sugestao_dia_util_apos(v_ref, 5),
                       public.fn_sugestao_dia_util_apos((p_aviso_em AT TIME ZONE 'America/Sao_Paulo')::date, 2));
  RETURN CASE WHEN v_hoje >= v_limite THEN 'concluir' ELSE 'aguardar' END;
END $$;

-- Rotina diária (service/cron). Idempotente: o aviso e a conclusão só acontecem uma vez por chamado.
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar(p_agora timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record; v_dec text; v_resp boolean; v_limite date; v_aut uuid;
  v_avisados int := 0; v_concluidos int := 0; v_cancelados int := 0;
BEGIN
  FOR r IN
    SELECT id, numero, titulo, user_id, atendente_id, resposta_aprovada_por, resposta_aprovada_em, aviso_autoconclusao_em
      FROM sugestoes
     WHERE status = 'aguardando_confirmacao' AND COALESCE(confirmado_pelo_autor, false) = false
       AND COALESCE(interno, false) = false AND resposta_aprovada_em IS NOT NULL
  LOOP
    v_resp := EXISTS (SELECT 1 FROM sugestao_mensagem m
                       WHERE m.sugestao_id = r.id AND m.papel = 'autor' AND m.criado_em > r.resposta_aprovada_em);
    v_dec := public.fn_sugestao_autoconfirmar_decisao(r.resposta_aprovada_em, r.aviso_autoconclusao_em, v_resp, p_agora);
    v_aut := COALESCE(r.atendente_id, r.resposta_aprovada_por, r.user_id);

    IF v_dec = 'cancelar' THEN
      UPDATE sugestoes SET aviso_autoconclusao_em = NULL WHERE id = r.id;
      v_cancelados := v_cancelados + 1;
    ELSIF v_dec = 'avisar' THEN
      v_limite := GREATEST(public.fn_sugestao_dia_util_apos((r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date, 5),
                           public.fn_sugestao_dia_util_apos((p_agora AT TIME ZONE 'America/Sao_Paulo')::date, 2));
      UPDATE sugestoes SET aviso_autoconclusao_em = p_agora WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, v_aut, 'ps', 'Aviso automático: este chamado foi resolvido em '
        || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído.');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'resposta', '#' || r.numero || ' · Confirme se resolveu: ' || COALESCE(NULLIF(btrim(r.titulo), ''), 'seu chamado'),
        'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído. '
        || 'Se algo não ficou certo, é só responder ou reabrir.');
      v_avisados := v_avisados + 1;
    ELSIF v_dec = 'concluir' THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = p_agora, concluido_automaticamente = true,
             encerrado_sem_confirmacao = true, encerrado_em = p_agora, confirmado_pelo_autor = false,
             encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente', updated_at = p_agora
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, v_aut, 'ps', 'Concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, reabra em até 30 dias.');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído: ' || COALESCE(NULLIF(btrim(r.titulo), ''), 'seu chamado'),
        'Seu chamado #' || r.numero || ' foi concluído por falta de retorno. Se algo não ficou certo, reabra em até 30 dias na Central de Melhorias.');
      v_concluidos := v_concluidos + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos, 'cancelados', v_cancelados);
END $$;

-- Cliente (autor ou colega da empresa) reabre em até 30 dias após a conclusão; volta para a fila do Code responsável.
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT id, user_id, company_id, status, concluido_em, numero INTO s FROM sugestoes WHERE id = p_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT (s.user_id = v_uid OR s.company_id IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF s.status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_concluida'); END IF;
  IF s.concluido_em IS NULL OR s.concluido_em < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_encerrado'); END IF;
  UPDATE sugestoes SET status = 'em_analise', reaberto_em = now(), concluido_em = NULL, concluido_automaticamente = false,
         encerrado_sem_confirmacao = false, confirmado_pelo_autor = false, aviso_autoconclusao_em = NULL,
         agente = NULL, em_atendimento_desde = NULL, ultimo_movimento = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'autor',
          'Chamado reaberto pelo cliente.' || CASE WHEN COALESCE(btrim(p_motivo), '') <> '' THEN ' Motivo: ' || btrim(p_motivo) ELSE '' END);
  RETURN jsonb_build_object('ok', true, 'status', 'em_analise');
END $$;

REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_dia_util_apos(date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar_decisao(timestamptz, timestamptz, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_dia_util_apos(date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_autoconfirmar_decisao(timestamptz, timestamptz, boolean, timestamptz) TO authenticated, service_role;

-- Seg–sex 08h de Brasília (11h UTC); a própria decisão ainda recusa feriado.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sugestao-autoconfirmar-diario';
    PERFORM cron.schedule('sugestao-autoconfirmar-diario', '0 11 * * 1-5', $cron$ SELECT public.fn_sugestao_autoconfirmar(); $cron$);
  END IF;
END $$;

-- RD-95: "?" do botão Reabrir
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'chamado.reabrir', 'Chamados', 'Reabrir chamado',
  'Nada a preencher: clique em "Reabrir" no chamado concluído. Se quiser, conte o que não ficou certo na conversa do chamado.',
  'Devolve o chamado para a equipe PS tratar com prioridade. Vale por 30 dias depois da conclusão, inclusive quando o chamado foi concluído automaticamente por falta de retorno (5 dias úteis).',
  'Chamado #123 concluído automaticamente em 10/10: em 20/10 você clica em Reabrir e ele volta para a fila da equipe.',
  'Esperar mais de 30 dias: depois disso o botão some e é preciso abrir um chamado novo citando o número antigo.',
  90, '/dashboard/melhorias', 'geral', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
