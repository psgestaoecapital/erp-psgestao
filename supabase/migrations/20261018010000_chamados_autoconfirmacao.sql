-- Confirmação automática de chamados (CEO 16/10 20:30, RD-97): aviso com 3 dias úteis sem resposta do cliente,
-- conclusão com 5 dias úteis (2 dias úteis depois do aviso), reabrir em até 30 dias com um clique.
-- Dias úteis = segunda a sexta, sem feriado nacional (fn_e_feriado_nacional). Aditiva: colunas e funções novas.
-- Resposta do cliente cancela: fn_sugestao_mensagem_enviar já tira o chamado de aguardando_confirmacao, e o aviso só
-- vale se for posterior à última resposta aprovada.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aviso_autoconclusao_em timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_automaticamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_sugestao_dia_util(p_data date) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT extract(isodow FROM p_data) < 6 AND NOT public.fn_e_feriado_nacional(p_data)
$$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_somar_dias_uteis(p_data date, p_dias integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_data; n integer := 0;
BEGIN
  WHILE n < GREATEST(p_dias, 0) LOOP
    d := d + 1;
    IF public.fn_sugestao_dia_util(d) THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- Decisão pura (testável): 'avisar' | 'concluir' | 'nada'. Datas no fuso de São Paulo.
-- Sem aviso válido: avisa quando passaram 3 dias úteis (backlog antigo também cai aqui, no 1º ciclo).
-- Com aviso válido (posterior à resposta aprovada): conclui 2 dias úteis depois do aviso (= 5 dias úteis no fluxo normal).
CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar_decisao(p_aprovada_em timestamptz, p_aviso_em timestamptz, p_agora timestamptz)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_hoje date := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;
        v_d0 date := (p_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_aprovada_em IS NULL OR NOT public.fn_sugestao_dia_util(v_hoje) THEN RETURN 'nada'; END IF;
  IF p_aviso_em IS NULL OR p_aviso_em < p_aprovada_em THEN
    RETURN CASE WHEN v_hoje >= public.fn_sugestao_somar_dias_uteis(v_d0, 3) THEN 'avisar' ELSE 'nada' END;
  END IF;
  RETURN CASE WHEN v_hoje >= public.fn_sugestao_somar_dias_uteis((p_aviso_em AT TIME ZONE 'America/Sao_Paulo')::date, 2)
              THEN 'concluir' ELSE 'nada' END;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_autoconfirmar(p_agora timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_dec text; v_avisados int := 0; v_concluidos int := 0; v_limite date; v_msg text; v_mail jsonb;
BEGIN
  FOR r IN
    SELECT s.id, s.numero, s.titulo, s.user_id, s.user_email, s.user_name, s.company_id, s.resposta_aprovada_em, s.aviso_autoconclusao_em
      FROM sugestoes s
     WHERE s.status = 'aguardando_confirmacao' AND COALESCE(s.resposta_aprovada,false) AND NOT COALESCE(s.confirmado_pelo_autor,false)
       AND s.resposta_aprovada_em IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sugestao_mensagem m WHERE m.sugestao_id = s.id AND m.papel = 'autor' AND m.criado_em > s.resposta_aprovada_em)
  LOOP
    v_dec := public.fn_sugestao_autoconfirmar_decisao(r.resposta_aprovada_em, r.aviso_autoconclusao_em, p_agora);
    IF v_dec = 'avisar' THEN
      v_limite := public.fn_sugestao_somar_dias_uteis((p_agora AT TIME ZONE 'America/Sao_Paulo')::date, 2);
      v_msg := 'Seu chamado #' || r.numero || ' foi resolvido em ' || to_char(r.resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
            || '. Se não houver retorno até ' || to_char(v_limite,'DD/MM/YYYY') || ', vamos considerá-lo concluído. Se algo não ficou certo, é só responder ou reabrir.';
      UPDATE sugestoes SET aviso_autoconclusao_em = p_agora, updated_at = now() WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, redigido_por)
        VALUES (r.id, r.user_id, 'ps', v_msg, 'autoconfirmacao');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
        VALUES (r.id, r.user_id, 'mensagem', '#' || r.numero || ' · Seu chamado será concluído em breve', v_msg);
      IF r.user_email IS NOT NULL AND position('@' in r.user_email) > 0 THEN
        BEGIN
          v_mail := public.fn_enviar_email(r.user_email, 'chamado_lembrete', jsonb_build_object(
            'nome', r.user_name, 'numero', r.numero, 'titulo_chamado', r.titulo, 'resposta', v_msg,
            'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || r.numero,
            'idempotency_key', 'chamado-autoconclusao-aviso-' || r.id::text || '-' || to_char(p_agora,'YYYYMMDD'), 'company_id', r.company_id));
        EXCEPTION WHEN OTHERS THEN
          PERFORM fn_ia_falha_registrar('pg','fn_sugestao_autoconfirmar','email_aviso_autoconclusao','email:resend', NULL, SQLERRM, r.company_id);
        END;
      END IF;
      v_avisados := v_avisados + 1;
    ELSIF v_dec = 'concluir' THEN
      UPDATE sugestoes SET status = 'concluida', concluido_em = p_agora, concluido_automaticamente = true,
        encerrado_sem_confirmacao = true, confirmado_pelo_autor = false, encerrado_em = p_agora,
        encerramento_motivo = 'concluído automaticamente após 5 dias úteis sem retorno do cliente', updated_at = now()
       WHERE id = r.id;
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, redigido_por)
        VALUES (r.id, r.user_id, 'ps', 'Chamado concluído automaticamente após 5 dias úteis sem retorno do cliente. Se algo não ficou certo, você pode reabrir em até 30 dias.', 'autoconfirmacao');
      INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
        VALUES (r.id, r.user_id, 'mensagem', '#' || r.numero || ' · Chamado concluído', 'Concluímos o chamado por falta de retorno. Se algo não ficou certo, reabra em até 30 dias.');
      v_concluidos := v_concluidos + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_avisados, 'concluidos', v_concluidos);
END $$;

-- Reabrir com um clique, em até 30 dias após a conclusão: autor ou alguém da mesma empresa ou fila PS.
CREATE OR REPLACE FUNCTION public.fn_sugestao_reabrir(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  SELECT id, user_id, company_id, status, concluido_em, numero INTO s FROM sugestoes WHERE id = p_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF NOT (auth.uid() = s.user_id OR is_admin() OR fn_pode_ver_fila_suporte()
          OR EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = s.company_id)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF s.status <> 'concluida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_esta_concluida'); END IF;
  IF s.concluido_em IS NULL OR s.concluido_em < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_de_30_dias_vencido'); END IF;
  UPDATE sugestoes SET status = 'em_desenvolvimento', reaberto_em = now(), resposta_aprovada = false,
    confirmado_pelo_autor = false, concluido_automaticamente = false, encerrado_sem_confirmacao = false,
    prioridade = 'alta', updated_at = now() WHERE id = p_id;
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
    VALUES (p_id, auth.uid(), CASE WHEN auth.uid() = s.user_id THEN 'autor' ELSE 'ps' END, 'Chamado reaberto.');
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || s.numero || ' · Chamado reaberto', 'Reaberto em até 30 dias após a conclusão (prioridade alta).'
      FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
  RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento');
END $$;

REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_reabrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_reabrir(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_sugestao_autoconfirmar_decisao(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_autoconfirmar_decisao(timestamptz, timestamptz, timestamptz) TO authenticated, service_role;

-- Dias úteis, horário comercial: 08:00 de Brasília (11:00 UTC), segunda a sexta (feriado é tratado na decisão).
SELECT cron.schedule('sugestao-autoconfirmar-diario', '0 11 * * 1-5', $$SELECT public.fn_sugestao_autoconfirmar()$$);

-- "?" (RD-95) do botão Reabrir chamado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'chamado.reabrir', 'Chamados', 'Reabrir chamado',
  'Nada a preencher: clique em "Reabrir chamado" se a solução não ficou certa. Vale por 30 dias depois da conclusão.',
  'O chamado volta para a equipe PS com prioridade alta e a conversa anterior continua no histórico. Chamados concluídos sozinhos, por falta de retorno em 5 dias úteis, também podem ser reabertos.',
  'Chamado #123 concluído automaticamente em 10/10: em 20/10 você clica em "Reabrir chamado" e a equipe volta a trabalhar nele.',
  'Esperar mais de 30 dias: depois disso o botão some e é preciso abrir um novo chamado. Se quiser explicar o problema, use "conversar" no próprio chamado.',
  1, '/dashboard/melhorias', 'gestao_empresarial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
