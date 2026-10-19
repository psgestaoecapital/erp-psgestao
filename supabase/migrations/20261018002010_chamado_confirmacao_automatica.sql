-- ci-sem-guarda: fn_sugestao_confirmacao_automatica — rotina de sistema (cron/service_role; EXECUTE só do service_role), percorre todas as empresas de propósito; nenhum usuário a chama.
-- ci-sem-guarda: fn_sugestao_reabrir — só o AUTOR do chamado reabre (auth.uid() = user_id do registro); a permissão é pela autoria, não por empresa.
-- Confirmação automática de chamados (CEO 16/10 20:30, msg 70a8b35f · RD-97).
-- aguardando_confirmacao: 3 dias úteis sem retorno → aviso ao cliente; 5 dias úteis → conclui sozinho.
-- Cliente pode reabrir em até 30 dias com um clique. Resposta do cliente cancela a conclusão automática.
-- Dias úteis = segunda a sexta, sem feriado nacional (fn_e_feriado_nacional). Nada muda em outros status.
-- Gate/teste: scripts/gates/check-chamado-confirmacao-automatica.ts

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_conclusao_auto_em timestamptz,
  ADD COLUMN IF NOT EXISTS conclusao_automatica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

-- Dias úteis decorridos APÓS p_de, até p_ate inclusive (p_de não conta).
CREATE OR REPLACE FUNCTION public.fn_dias_uteis_entre(p_de date, p_ate date)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(count(*), 0)::int
    FROM generate_series(p_de + 1, p_ate, interval '1 day') g(d)
   WHERE extract(isodow FROM g.d) < 6 AND NOT public.fn_e_feriado_nacional(g.d::date);
$$;

-- Soma p_n dias úteis a p_data (p_n >= 0).
CREATE OR REPLACE FUNCTION public.fn_somar_dias_uteis(p_data date, p_n int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE d date := p_data; k int := 0;
BEGIN
  WHILE k < p_n LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN k := k + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- Rotina diária. p_hoje permite provar os prazos (3 e 5 dias úteis, fim de semana, feriado).
CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmacao_automatica(p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record; v_base date; v_aviso date; v_limite date; v_msg text; v_mail jsonb;
  v_avisados int := 0; v_concluidos int := 0; v_cancelados int := 0; v_ps uuid; v_ps_email text;
BEGIN
  SELECT u.id, u.email INTO v_ps, v_ps_email FROM users u
   WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'));
  IF v_ps IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'conta_ps_nao_configurada'); END IF;
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = ''
          OR auth.role() = 'service_role'
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Só PS_ADMIN/cron roda a confirmação automática' USING errcode = '42501';
  END IF;
  -- só em dia útil (horário comercial é o do cron)
  IF extract(isodow FROM p_hoje) >= 6 OR public.fn_e_feriado_nacional(p_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util');
  END IF;

  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.user_email, s.user_name, s.company_id,
           s.aviso_conclusao_auto_em,
           (coalesce(s.resposta_aprovada_em, s.updated_at) AT TIME ZONE 'America/Sao_Paulo')::date AS base,
           EXISTS (SELECT 1 FROM sugestao_mensagem m
                    WHERE m.sugestao_id = s.id AND m.papel = 'autor'
                      AND m.criado_em > coalesce(s.resposta_aprovada_em, s.updated_at)) AS cliente_respondeu
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND coalesce(s.confirmado_pelo_autor, false) = false
       AND coalesce(s.interno, false) = false
     ORDER BY s.numero
  LOOP
    -- resposta do cliente depois da resposta da PS cancela a conclusão automática
    IF r.cliente_respondeu THEN
      IF r.aviso_conclusao_auto_em IS NOT NULL THEN
        UPDATE sugestoes SET aviso_conclusao_auto_em = NULL WHERE id = r.id;
        v_cancelados := v_cancelados + 1;
      END IF;
      CONTINUE;
    END IF;

    v_base := r.base;
    IF r.aviso_conclusao_auto_em IS NULL THEN
      IF public.fn_dias_uteis_entre(v_base, p_hoje) >= 3 THEN
        v_limite := public.fn_somar_dias_uteis(p_hoje, 2);
        v_msg := 'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(v_base, 'DD/MM/YYYY')
              || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY')
              || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.';
        UPDATE sugestoes SET aviso_conclusao_auto_em = (p_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '11 hours' WHERE id = r.id;
        INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
        VALUES (r.id, v_ps, v_ps_email, 'ps', v_msg, 'sistema:confirmacao_automatica');
        INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
        VALUES (r.id, r.user_id, 'aviso_conclusao', '#' || r.numero || ' · Confirme seu chamado', v_msg);
        IF r.user_email IS NOT NULL AND position('@' IN r.user_email) > 0 THEN
          BEGIN
            v_mail := public.fn_enviar_email(r.user_email, 'chamado_lembrete', jsonb_build_object(
              'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', v_msg,
              'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
              'idempotency_key', 'chamado-aviso-conclusao-' || r.id::text, 'company_id', r.company_id));
          EXCEPTION WHEN OTHERS THEN
            PERFORM fn_ia_falha_registrar('pg','fn_sugestao_confirmacao_automatica','email_aviso_conclusao','email:resend', NULL, SQLERRM, r.company_id);
          END;
        END IF;
        v_avisados := v_avisados + 1;
      END IF;
    ELSE
      v_aviso := (r.aviso_conclusao_auto_em AT TIME ZONE 'America/Sao_Paulo')::date;
      -- 5 dias úteis desde a resposta E 2 dias úteis desde o aviso (backlog: aviso primeiro, conclusão 2 úteis depois)
      IF public.fn_dias_uteis_entre(v_base, p_hoje) >= 5 AND public.fn_dias_uteis_entre(v_aviso, p_hoje) >= 2 THEN
        UPDATE sugestoes SET
          status = 'concluida', concluido_em = now(), conclusao_automatica = true,
          encerrado_sem_confirmacao = true, encerrado_em = now(),
          encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
          confirmado_pelo_autor = false, updated_at = now()
        WHERE id = r.id;
        INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, redigido_por)
        VALUES (r.id, v_ps, v_ps_email, 'ps', 'Concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.', 'sistema:confirmacao_automatica');
        INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
        VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído',
                'Concluímos o chamado após 5 dias úteis sem retorno. Se algo não ficou certo, reabra em até 30 dias.');
        v_concluidos := v_concluidos + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos, 'cancelados_por_resposta', v_cancelados);
END $$;

-- Reabrir com um clique, em até 30 dias após a conclusão (só o autor ou alguém da mesma empresa que o autor).
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_autor uuid; v_status text; v_conc timestamptz; v_numero int;
BEGIN
  SELECT user_id, status, concluido_em, numero INTO v_autor, v_status, v_conc, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_reabre'); END IF;
  IF v_status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF v_conc IS NULL OR v_conc < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;

  -- volta à fila (agente NULL: v_chamado_code_responsavel devolve ao Code da carteira) com prioridade
  UPDATE sugestoes SET status = 'em_desenvolvimento', resposta_aprovada = false, confirmado_pelo_autor = false,
    conclusao_automatica = false, encerrado_sem_confirmacao = false, aviso_conclusao_auto_em = NULL,
    prioridade = 'alta', agente = NULL, em_atendimento_desde = NULL, reaberto_em = now(),
    ultimo_movimento = now(), updated_at = now()
  WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
  VALUES (p_id, v_autor, 'autor', 'Reaberto pelo cliente (dentro de 30 dias da conclusão).');
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', 'Reaberto com um clique, dentro de 30 dias. Prioridade alta.'
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_sugestao_confirmacao_automatica(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_confirmacao_automatica(date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid) TO authenticated, service_role;

-- Seg–sex 11:15 UTC (08:15 BRT).
SELECT cron.schedule('sugestao-confirmacao-automatica', '15 11 * * 1-5', $$SELECT public.fn_sugestao_confirmacao_automatica();$$);

-- RD-95: "?" do botão Reabrir chamado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'chamado.reabrir', 'Chamados', 'Reabrir chamado',
  'Nada a preencher: clique em "Reabrir chamado" se a solução não ficou certa. Vale por 30 dias depois da conclusão.',
  'O chamado volta para a equipe PS com prioridade alta e a conversa anterior continua no histórico. Chamados concluídos sozinhos, por falta de retorno em 5 dias úteis, também podem ser reabertos.',
  'Chamado #123 concluído automaticamente em 10/10: em 20/10 você clica em "Reabrir chamado" e a equipe volta a trabalhar nele.',
  'Esperar mais de 30 dias: depois disso o botão some e é preciso abrir um novo chamado. Se quiser explicar o problema, use "conversar" no próprio chamado.',
  1, '/dashboard/melhorias', 'gestao_empresarial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
