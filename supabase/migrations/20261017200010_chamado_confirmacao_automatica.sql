-- Confirmação automática de chamados (CEO 16/10 20:30, RD-97) — gilberto-chamados.
-- Chamado em aguardando_confirmacao: 3 dias úteis sem retorno do cliente → aviso; 5 dias úteis → conclui sozinho.
-- Backlog: todos recebem o aviso no 1º ciclo e concluem 2 dias úteis depois. Resposta do cliente cancela.
-- Cliente reabre em até 30 dias após a conclusão (fn_sugestao_reabrir_concluida). Só funções/colunas NOVAS.
-- Dias úteis = segunda a sexta sem feriado nacional (fn_e_feriado_nacional), no fuso America/Sao_Paulo.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_conclusao_em timestamptz,
  ADD COLUMN IF NOT EXISTS conclusao_prevista_em date;

-- dias úteis em (a, b] (a exclusivo, b inclusivo)
CREATE OR REPLACE FUNCTION public.fn_chamado_dias_uteis_entre(p_de date, p_ate date)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM generate_series(p_de + 1, p_ate, interval '1 day') g(d)
   WHERE extract(isodow FROM g.d) < 6 AND NOT public.fn_e_feriado_nacional(g.d::date);
$$;

-- data após somar N dias úteis
CREATE OR REPLACE FUNCTION public.fn_chamado_somar_dias_uteis(p_de date, p_n int)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_de; k int := 0;
BEGIN
  WHILE k < p_n LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN k := k + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- Rotina diária (horário comercial, dia útil). p_agora existe para o teste provar os prazos.
CREATE OR REPLACE FUNCTION public.fn_chamado_confirmacao_automatica(p_agora timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_hoje date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ps uuid; v_ps_email text; r record; v_ref timestamptz; v_ref_d date;
  v_avisados int := 0; v_concluidos int := 0; v_limite date; v_mail jsonb; v_txt text;
BEGIN
  IF NOT (v_interno OR auth.role() = 'service_role'
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Só PS_ADMIN/cron roda a confirmação automática' USING ERRCODE = '42501';
  END IF;
  IF extract(isodow FROM v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util');
  END IF;
  v_ps_email := (SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email');
  v_ps := (SELECT id FROM users WHERE lower(email) = lower(v_ps_email) LIMIT 1);
  IF v_ps IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'conta_ps_nao_configurada'); END IF;

  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.user_email, s.user_name, s.company_id, s.aviso_conclusao_em, s.conclusao_prevista_em,
           greatest(coalesce(s.resposta_aprovada_em, s.updated_at),
                    coalesce((SELECT max(m.criado_em) FROM sugestao_mensagem m WHERE m.sugestao_id = s.id AND m.papel = 'autor'), '-infinity')) AS ref
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND COALESCE(s.interno, false) = false
  LOOP
    v_ref := r.ref; v_ref_d := (v_ref AT TIME ZONE 'America/Sao_Paulo')::date;
    -- aviso anterior ao último retorno do cliente não vale mais (resposta cancela a conclusão)
    IF r.aviso_conclusao_em IS NOT NULL AND r.aviso_conclusao_em < v_ref THEN
      UPDATE sugestoes SET aviso_conclusao_em = NULL, conclusao_prevista_em = NULL WHERE id = r.id;
      r.aviso_conclusao_em := NULL;
    END IF;

    IF r.aviso_conclusao_em IS NULL THEN
      IF public.fn_chamado_dias_uteis_entre(v_ref_d, v_hoje) < 3 THEN CONTINUE; END IF;
      v_limite := public.fn_chamado_somar_dias_uteis(v_hoje, 2);
      v_txt := 'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(v_ref AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
            || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY')
            || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.';
      UPDATE sugestoes SET aviso_conclusao_em = p_agora, conclusao_prevista_em = v_limite WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
      VALUES (r.id, v_ps, v_ps_email, 'ps', v_txt, p_agora);
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'mensagem', '#' || r.numero || ' · Seu chamado será concluído em ' || to_char(v_limite, 'DD/MM'), v_txt);
      IF r.user_email IS NOT NULL AND position('@' IN r.user_email) > 0 THEN
        BEGIN
          v_mail := public.fn_enviar_email(r.user_email, 'chamado_lembrete', jsonb_build_object(
            'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', v_txt,
            'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
            'idempotency_key', 'chamado-aviso-conclusao-' || r.id::text || '-' || to_char(p_agora, 'YYYYMMDD'), 'company_id', r.company_id));
        EXCEPTION WHEN OTHERS THEN
          PERFORM fn_ia_falha_registrar('pg','fn_chamado_confirmacao_automatica','email_aviso_conclusao','email:resend', NULL, SQLERRM, r.company_id);
        END;
      END IF;
      v_avisados := v_avisados + 1;
    ELSIF v_hoje >= r.conclusao_prevista_em THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = p_agora, updated_at = p_agora,
             encerrado_sem_confirmacao = true, encerrado_em = p_agora, confirmado_pelo_autor = false,
             encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente'
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em)
      VALUES (r.id, v_ps, v_ps_email, 'ps', 'concluído automaticamente após 5 dias úteis sem retorno do cliente. '
              || 'Se algo não ficou certo, você pode reabrir em até 30 dias.', p_agora);
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'mensagem', '#' || r.numero || ' · Chamado concluído',
              'Concluímos o chamado automaticamente por falta de retorno. Se algo não ficou certo, reabra em até 30 dias.');
      v_concluidos := v_concluidos + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos);
END $$;

-- Cliente reabre chamado concluído em até 30 dias; volta para a carteira do Code (agente mantido) com prioridade.
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir_concluida(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_autor uuid; v_status text; v_conc timestamptz; v_numero int; v_txt text;
BEGIN
  SELECT user_id, status, coalesce(concluido_em, updated_at), numero INTO v_autor, v_status, v_conc, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() IS DISTINCT FROM v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_reabre'); END IF;
  IF v_status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF v_conc < now() - interval '30 days' THEN RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;
  v_txt := coalesce(nullif(btrim(p_motivo), ''), 'Reaberto pelo cliente.');
  UPDATE sugestoes SET status = 'em_desenvolvimento', confirmado_pelo_autor = false, resposta_aprovada = false,
         encerrado_sem_confirmacao = false, aviso_conclusao_em = NULL, conclusao_prevista_em = NULL,
         prioridade = CASE WHEN prioridade IN ('baixa','media') THEN 'alta' ELSE prioridade END,
         ultimo_movimento = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em) VALUES (p_id, v_autor, 'autor', v_txt, now());
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', v_txt
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_chamado_confirmacao_automatica(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamado_confirmacao_automatica(timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir_concluida(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir_concluida(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_chamado_dias_uteis_entre(date, date), public.fn_chamado_somar_dias_uteis(date, int) FROM PUBLIC, anon;

-- 12:30 UTC = 09:30 em Brasília, dias úteis (a função ainda confere feriado)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-confirmacao-automatica') THEN
    PERFORM cron.schedule('chamado-confirmacao-automatica', '30 12 * * 1-5', 'SELECT public.fn_chamado_confirmacao_automatica();');
  END IF;
END $$;
