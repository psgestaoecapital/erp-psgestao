-- Despertador automático dos agentes (CEO 04/10). A rotina do Code é acionada quando a mensagem chega (#1998); se ela
-- ficar parada (rotina caiu, sessão encerrou antes de terminar), o despertador a aciona de novo.
-- A cada 15 min (pg_cron, jobname agente_despertador), para cada agente com acionamento ligado, pega a mensagem
-- EXECUTÁVEL mais antiga (tarefa, recebida/em_andamento, com OK do CEO quando exigido) parada há mais de 20 min e chama
-- fn_agente_acionar — NO MÁXIMO um disparo por agente por rodada.
-- Freios: não redispara a mesma mensagem com menos de 20 min do último disparo; teto de 12 redisparos por mensagem
-- (bateu o teto, para e deixa UM alerta para o Eng. Chefe em erp_contexto_projeto); nunca dispara mensagem que
-- requer_ok_ceo sem ok_ceo_em; cada redisparo fica no histórico da mensagem (acionamento_historico).
-- Só serviço (REVOKE de anon/authenticated). Nenhuma função de guarda é alterada (RD-91). Migration aditiva.
--
-- Parâmetros p_somente / p_simular existem para o TESTE (aceitação): restringem a uma mensagem e registram o
-- redisparo sem chamar a rotina de verdade. O agendamento usa só os padrões.

ALTER TABLE public.erp_agente_mensagem
  ADD COLUMN IF NOT EXISTS acionamento_historico jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS redisparos            integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerta_teto_em        timestamptz;

CREATE OR REPLACE FUNCTION public.fn_agente_despertador(p_parado interval DEFAULT interval '20 minutes',
                                                        p_teto integer DEFAULT 12,
                                                        p_somente uuid DEFAULT NULL,
                                                        p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; m record; v_res jsonb; v_disparos jsonb := '[]'::jsonb; v_alertas int := 0;
BEGIN
  PERFORM public.fn__agente_assert_servico();

  -- (1) mensagens que bateram o teto: para de disparar e avisa o Eng. Chefe, uma vez só
  FOR m IN
    SELECT msg.id, msg.para, msg.assunto, msg.redisparos
      FROM erp_agente_mensagem msg JOIN erp_agente_rotina ro ON ro.agente = msg.para
     WHERE ro.aciona AND NOT msg.arquivada AND msg.tipo = 'tarefa'
       AND msg.status IN ('recebida','em_andamento')
       AND (NOT msg.requer_ok_ceo OR msg.ok_ceo_em IS NOT NULL)
       AND msg.redisparos >= p_teto AND msg.alerta_teto_em IS NULL
       AND (p_somente IS NULL OR msg.id = p_somente)
       AND msg.atualizado_em < now() - p_parado
  LOOP
    INSERT INTO erp_contexto_projeto (projeto, categoria, prioridade, titulo, descricao, refs, criado_por, tags)
    VALUES ('agentes_caixa', 'pendencia', 'critica',
            'ALERTA: despertador parou de acionar a mensagem ' || left(m.id::text, 8) || ' (' || m.para || ')',
            'A mensagem "' || m.assunto || '" (' || m.id || ') da caixa de ' || m.para || ' foi redisparada '
            || m.redisparos || ' vezes e continua parada. O despertador parou (teto de ' || p_teto || '). '
            || 'Ação do Eng. Chefe: ver a sessão da rotina, responder/arquivar a mensagem ou reenviar.',
            jsonb_build_object('mensagem_id', m.id, 'agente', m.para, 'teto', p_teto),
            'agente_despertador', ARRAY['alerta','despertador']);
    UPDATE erp_agente_mensagem SET alerta_teto_em = now() WHERE id = m.id;
    v_alertas := v_alertas + 1;
  END LOOP;

  -- (2) um disparo por agente com acionamento ligado: a mais antiga, executável, parada e abaixo do teto
  FOR r IN SELECT agente FROM erp_agente_rotina WHERE aciona ORDER BY agente LOOP
    SELECT msg.id, msg.redisparos INTO m
      FROM erp_agente_mensagem msg
     WHERE msg.para = r.agente AND NOT msg.arquivada AND msg.tipo = 'tarefa'
       AND msg.status IN ('recebida','em_andamento')
       AND (NOT msg.requer_ok_ceo OR msg.ok_ceo_em IS NOT NULL)          -- nunca sem o OK do CEO
       AND msg.redisparos < p_teto
       AND msg.atualizado_em < now() - p_parado                          -- parada há mais de 20 min
       AND COALESCE((msg.acionamento->>'em')::timestamptz, '-infinity') < now() - p_parado  -- último disparo > 20 min
       AND (p_somente IS NULL OR msg.id = p_somente)
     ORDER BY msg.criado_em
     LIMIT 1
       FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;

    IF p_simular THEN
      v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'simulado');
      UPDATE erp_agente_mensagem SET acionamento = v_res, atualizado_em = now() WHERE id = m.id;
    ELSE
      v_res := public.fn_agente_acionar(m.id) - 'ok';
    END IF;

    UPDATE erp_agente_mensagem
       SET redisparos = redisparos + 1,
           acionamento_historico = acionamento_historico
             || jsonb_build_array(jsonb_build_object('origem', 'despertador', 'n', redisparos + 1, 'em', now(), 'resultado', v_res))
     WHERE id = m.id;
    v_disparos := v_disparos || jsonb_build_array(jsonb_build_object('mensagem_id', m.id, 'agente', r.agente, 'n', m.redisparos + 1, 'resultado', v_res));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'disparos', v_disparos, 'alertas_teto', v_alertas);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_despertador(interval, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_despertador(interval, integer, uuid, boolean) TO service_role;

-- agendamento idempotente: a cada 15 min
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agente_despertador') THEN
    PERFORM cron.unschedule('agente_despertador');
  END IF;
  PERFORM cron.schedule('agente_despertador', '*/15 * * * *', 'SELECT public.fn_agente_despertador();');
END
$cron$;
