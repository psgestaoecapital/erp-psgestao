-- Confirmação automática de chamados (decisão do CEO 16/10 20:30, RD-97 — comportamento novo visível ao cliente).
-- Chamado em "aguardando_confirmacao" sem retorno do cliente: aviso com 3 dias úteis; conclusão automática com 5 dias úteis.
-- Backlog (já passou de 5 dias úteis): aviso no 1º ciclo e conclusão 2 dias úteis depois. Resposta do cliente cancela
-- (o gatilho trg_sugestao_autor_respondeu já tira a resposta de "aprovada" e o status sai de aguardando_confirmacao).
-- Reabrir: o autor ou colega da empresa, em até 30 dias após a conclusão. Dias úteis = seg–sex sem feriado nacional.
-- Aditiva: colunas novas + funções novas. Nada é apagado (RD-30).

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_em     timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_limite date,
  ADD COLUMN IF NOT EXISTS concluido_automaticamente  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em                timestamptz;

-- ── funções puras de prazo (testáveis sem gravar nada) ───────────────────────────────────────────
-- dias úteis APÓS p_ini até p_fim (inclusive), sem sábado, domingo e feriado nacional
CREATE OR REPLACE FUNCTION public.fn_sugestao_du_entre(p_ini date, p_fim date)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_ini; n integer := 0;
BEGIN
  IF p_ini IS NULL OR p_fim IS NULL THEN RETURN 0; END IF;
  WHILE d < p_fim LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- a data que fecha p_n dias úteis depois de p_data
CREATE OR REPLACE FUNCTION public.fn_sugestao_somar_du(p_data date, p_n integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_data; n integer := 0;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  WHILE n < GREATEST(COALESCE(p_n, 0), 0) LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT public.fn_e_feriado_nacional(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- data limite informada no aviso: 5 dias úteis da resposta; se isso já passou (backlog), 2 dias úteis a partir de hoje
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_limite(p_aprovada date, p_hoje date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.fn_sugestao_somar_du(p_aprovada, 5) > p_hoje
              THEN public.fn_sugestao_somar_du(p_aprovada, 5)
              ELSE public.fn_sugestao_somar_du(p_hoje, 2) END
$$;

-- o que fazer hoje com um chamado: 'nada' | 'avisar' | 'concluir'
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_fase(p_aprovada date, p_limite date, p_hoje date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_aprovada IS NULL THEN 'nada'
    WHEN p_limite IS NULL THEN CASE WHEN public.fn_sugestao_du_entre(p_aprovada, p_hoje) >= 3 THEN 'avisar' ELSE 'nada' END
    WHEN p_limite <= p_hoje THEN 'concluir'
    ELSE 'nada' END
$$;

-- ── rotina diária (cron, dia útil, horário comercial) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r record; v_fase text; v_limite date; v_avisados int := 0; v_concluidos int := 0;
BEGIN
  IF extract(isodow FROM v_hoje) >= 6 OR public.fn_e_feriado_nacional(v_hoje) THEN
    RETURN jsonb_build_object('ok', true, 'pulou', 'nao_e_dia_util');
  END IF;
  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.resposta_aprovada_em, s.aviso_autoconclusao_limite,
           s.aviso_autoconclusao_em, COALESCE(s.atendente_id, s.user_id) AS autor_msg
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao'
       AND COALESCE(s.resposta_aprovada, false) = true
       AND COALESCE(s.confirmado_pelo_autor, false) = false
       AND s.resposta_aprovada_em IS NOT NULL
       -- resposta do cliente depois da resposta da PS cancela (o gatilho já desmarca, isto é a rede de segurança)
       AND NOT EXISTS (SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id = s.id AND m.papel = 'autor'
                        AND m.criado_em > s.resposta_aprovada_em)
     ORDER BY s.resposta_aprovada_em
  LOOP
    v_fase := public.fn_sugestao_autoconfirmar_fase(
      (r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date, r.aviso_autoconclusao_limite, v_hoje);
    IF v_fase = 'avisar' THEN
      v_limite := public.fn_sugestao_autoconfirmar_limite(
        (r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date, v_hoje);
      UPDATE sugestoes SET aviso_autoconclusao_em = now(), aviso_autoconclusao_limite = v_limite WHERE id = r.id;
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'aviso_autoconclusao',
        '#' || r.numero || ' · Seu chamado foi resolvido',
        'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
        || '. Se não houver retorno até ' || to_char(v_limite, 'DD/MM/YYYY') || ', vamos considerá-lo concluído. '
        || 'Se algo não ficou certo, é só responder ou reabrir.');
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, r.autor_msg, 'ps', 'Aviso automático: sem retorno até ' || to_char(v_limite, 'DD/MM/YYYY')
        || ', o chamado será considerado concluído.');
      v_avisados := v_avisados + 1;
    ELSIF v_fase = 'concluir' THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = now(), concluido_automaticamente = true,
             encerrado_sem_confirmacao = true, confirmado_pelo_autor = false, encerrado_em = now(),
             encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente',
             updated_at = now()
       WHERE id = r.id AND status = 'aguardando_confirmacao';
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
      VALUES (r.id, r.autor_msg, 'ps', 'Concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
      VALUES (r.id, r.user_id, 'encerrado', '#' || r.numero || ' · Chamado concluído',
        'Concluímos o chamado após 5 dias úteis sem retorno. Se algo não ficou certo, reabra em até 30 dias na Central de Melhorias.');
      v_concluidos := v_concluidos + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos);
END $$;

-- ── reabrir em até 30 dias (autor ou colega da empresa) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_sessao'); END IF;
  SELECT id, numero, user_id, company_id, status, concluido_em INTO s FROM sugestoes WHERE id = p_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT (s.user_id = v_uid OR (s.company_id IS NOT NULL AND s.company_id IN (SELECT public.get_user_company_ids()))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF s.status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF s.concluido_em IS NULL OR s.concluido_em < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;
  UPDATE sugestoes SET status = 'em_desenvolvimento', prioridade = 'alta', resposta_aprovada = false,
         confirmado_pelo_autor = false, concluido_em = NULL, concluido_automaticamente = false,
         encerrado_sem_confirmacao = false, aviso_autoconclusao_em = NULL, aviso_autoconclusao_limite = NULL,
         reaberto_em = now(), agente = NULL, em_atendimento_desde = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
  VALUES (p_id, v_uid, 'autor', COALESCE(NULLIF(btrim(p_motivo), ''), 'Reabri o chamado: algo não ficou certo.'));
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  SELECT p_id, u.id, 'reaberto', '#' || s.numero || ' · Chamado reaberto pelo cliente (prioridade)', COALESCE(NULLIF(btrim(p_motivo), ''), 'Reaberto em até 30 dias da conclusão.')
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
END $$;

-- ── permissões ───────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_du_entre(date, date), public.fn_sugestao_somar_du(date, integer),
  public.fn_sugestao_autoconfirmar_limite(date, date), public.fn_sugestao_autoconfirmar_fase(date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_du_entre(date, date), public.fn_sugestao_somar_du(date, integer),
  public.fn_sugestao_autoconfirmar_limite(date, date), public.fn_sugestao_autoconfirmar_fase(date, date, date) TO authenticated, service_role;

-- cron: dias úteis, 09:00 de Brasília (12:00 UTC)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sugestao-autoconfirmar-diario';
    PERFORM cron.schedule('sugestao-autoconfirmar-diario', '0 12 * * 1-5', 'SELECT public.fn_sugestao_autoconfirmar();');
  END IF;
END $$;

-- "?" do botão Reabrir (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'melhorias.reabrir', 'Chamados', 'Reabrir chamado', 'Toque em Reabrir se algo não ficou certo. Se quiser, diga o que faltou.', 'Chamado concluído pode voltar para a equipe em até 30 dias, com prioridade.', 'Chamado concluído sozinho após 5 dias úteis sem retorno: toque em Reabrir e conte o que ainda não funciona.', 'Esperar mais de 30 dias: depois disso é preciso abrir um chamado novo.', 20, '/dashboard/melhorias', 'geral', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
