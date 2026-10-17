-- Confirmação automática de chamados (CEO 16/10 20:30, RD-97 — comportamento novo visível ao cliente, autorizado).
-- Chamado em "aguardando_confirmacao":
--   * 3 dias úteis sem retorno do cliente  -> aviso ("se não houver retorno até <data>, vamos considerá-lo concluído");
--   * 2 dias úteis depois do aviso (= 5 dias úteis; backlog: aviso no 1º ciclo e conclusão 2 du depois) -> conclui sozinho;
--   * qualquer mensagem do cliente depois da resposta da PS cancela (aviso some, nada é concluído);
--   * o cliente reabre em até 30 dias depois da conclusão, com um clique (volta para a fila do Code da carteira, prioridade alta).
-- Dias úteis = segunda a sexta sem feriado nacional (fn_e_feriado_nacional). Nada é apagado (RD-30).
-- Aditiva: colunas novas + funções novas; as funções existentes (lembrete, encerrar_sem_confirmacao) não são tocadas.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_em timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_automaticamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

-- ---------------------------------------------------------------------------------------------------------------
-- Puras (sem tabela): os prazos ficam testáveis.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sugestao_somar_dias_uteis(p_data date, p_dias integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_data; n integer := 0;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  WHILE n < GREATEST(p_dias, 0) LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- 'nada' | 'avisar' | 'concluir' | 'cancelar'
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_decisao(
  p_base date, p_aviso date, p_hoje date, p_cliente_respondeu boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_base IS NULL THEN 'nada'
    WHEN COALESCE(p_cliente_respondeu, false) THEN CASE WHEN p_aviso IS NOT NULL THEN 'cancelar' ELSE 'nada' END
    WHEN p_aviso IS NULL THEN
      CASE WHEN p_hoje >= public.fn_sugestao_somar_dias_uteis(p_base, 3) THEN 'avisar' ELSE 'nada' END
    WHEN p_hoje >= public.fn_sugestao_somar_dias_uteis(p_aviso, 2) THEN 'concluir'
    ELSE 'nada'
  END
$$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_pode_reabrir(p_concluido_em timestamptz, p_agora timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT p_concluido_em IS NOT NULL AND p_agora <= p_concluido_em + interval '30 days'
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Rotina diária (horário comercial, só dia útil). Só cron/PS_ADMIN.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar(p_hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_hoje date := COALESCE(p_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  r record; v_dec text; v_limite date; v_texto text; v_mail jsonb;
  v_avisados int := 0; v_concluidos int := 0; v_cancelados int := 0;
BEGIN
  IF NOT (v_interno OR auth.role() = 'service_role'
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Só PS_ADMIN/cron roda a confirmação automática' USING errcode = '42501';
  END IF;
  IF extract(isodow FROM v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util', 'dia', v_hoje);
  END IF;

  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.user_email, s.user_name, s.company_id, s.aviso_autoconclusao_em,
           -- base = última mensagem/aprovação da PS (a mensagem automática do sistema não conta)
           GREATEST(s.resposta_aprovada_em,
                    (SELECT max(m.criado_em) FROM sugestao_mensagem m
                      WHERE m.sugestao_id = s.id AND m.papel = 'ps' AND m.redigido_por IS DISTINCT FROM 'sistema-autoconfirmacao')
                   ) AS base_em
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND COALESCE(s.interno, false) = false
  LOOP
    v_dec := public.fn_sugestao_autoconfirmar_decisao(
      (r.base_em AT TIME ZONE 'America/Sao_Paulo')::date,
      (r.aviso_autoconclusao_em AT TIME ZONE 'America/Sao_Paulo')::date,
      v_hoje,
      -- resposta do cliente depois da base (ou depois do aviso) cancela
      EXISTS (SELECT 1 FROM sugestao_mensagem m
               WHERE m.sugestao_id = r.id AND m.papel = 'autor' AND m.criado_em > COALESCE(r.base_em, '-infinity')));

    IF v_dec = 'avisar' THEN
      v_limite := public.fn_sugestao_somar_dias_uteis(v_hoje, 2);
      v_texto := 'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.base_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído. '
        || 'Se algo não ficou certo, é só responder ou reabrir.';
      UPDATE sugestoes SET aviso_autoconclusao_em = now() WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
      VALUES (r.id, r.user_id, NULL, 'ps', v_texto, 'sistema-autoconfirmacao');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'aviso_autoconclusao', '#' || r.numero || ' · Chamado resolvido: confirme ou responda', v_texto);
      IF r.user_email IS NOT NULL AND position('@' in r.user_email) > 0 THEN
        BEGIN
          v_mail := public.fn_enviar_email(r.user_email, 'chamado_lembrete', jsonb_build_object(
            'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', v_texto,
            'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
            'idempotency_key', 'chamado-autoconf-aviso-' || r.id::text, 'company_id', r.company_id));
        EXCEPTION WHEN OTHERS THEN
          PERFORM fn_ia_falha_registrar('pg','fn_sugestao_autoconfirmar','email_aviso_autoconclusao','email:resend', NULL, SQLERRM, r.company_id);
        END;
      END IF;
      v_avisados := v_avisados + 1;

    ELSIF v_dec = 'concluir' THEN
      PERFORM set_config('app.chamado_troca', '1', true);   -- o job não é "atendente": passa pela trava de atendimento
      UPDATE sugestoes SET
        status = 'concluida', concluido_em = now(), concluido_automaticamente = true,
        encerrado_sem_confirmacao = true, confirmado_pelo_autor = false,
        encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
        encerrado_em = now(), updated_at = now()
      WHERE id = r.id AND status = 'aguardando_confirmacao';
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
      VALUES (r.id, r.user_id, NULL, 'ps', 'Chamado concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.', 'sistema-autoconfirmacao');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído',
              'Concluímos o chamado após 5 dias úteis sem retorno. Se algo não ficou certo, reabra em até 30 dias pelo próprio chamado.');
      v_concluidos := v_concluidos + 1;

    ELSIF v_dec = 'cancelar' THEN
      UPDATE sugestoes SET aviso_autoconclusao_em = NULL WHERE id = r.id;   -- o cliente respondeu: sai do relógio
      v_cancelados := v_cancelados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'dia', v_hoje, 'avisados', v_avisados, 'concluidos', v_concluidos, 'cancelados', v_cancelados);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reabrir (cliente): autor ou usuário da mesma empresa, em até 30 dias depois da conclusão.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  SELECT id, numero, user_id, company_id, status, concluido_em INTO s FROM sugestoes WHERE id = p_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT (s.user_id = v_uid OR (s.company_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = s.company_id))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF s.status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF NOT public.fn_sugestao_pode_reabrir(s.concluido_em) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido');
  END IF;

  PERFORM set_config('app.chamado_troca', '1', true);
  UPDATE sugestoes SET
    status = 'em_analise', concluido_em = NULL, concluido_automaticamente = false, encerrado_sem_confirmacao = false,
    encerramento_motivo = NULL, aviso_autoconclusao_em = NULL, reaberto_em = now(),
    prioridade = CASE WHEN prioridade IN ('critica') THEN prioridade ELSE 'alta' END,
    resposta_aprovada = false, atendente_id = NULL, agente = NULL, em_atendimento_desde = NULL,
    ultimo_movimento = now(), updated_at = now()
  WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'autor', 'Reabri o chamado: algo não ficou certo.');
  RETURN jsonb_build_object('ok', true, 'status', 'em_analise');
END $$;

REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid) TO authenticated;
-- puras: sem dado, podem ser chamadas pelo teste
GRANT EXECUTE ON FUNCTION public.fn_sugestao_somar_dias_uteis(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_autoconfirmar_decisao(date, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_pode_reabrir(timestamptz, timestamptz) TO authenticated;

-- Cron diário, 11:00 UTC (08:00 São Paulo); a função pula fim de semana e feriado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sugestao-autoconfirmar-diario';
    PERFORM cron.schedule('sugestao-autoconfirmar-diario', '0 11 * * 1-5', 'SELECT public.fn_sugestao_autoconfirmar();');
  END IF;
END $$;
