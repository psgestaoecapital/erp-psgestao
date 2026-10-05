-- Velocidade dos agentes (CEO 04/10, ordem da noite 05/10). Aditiva.
-- (B) Despertador a cada 5 min; reaciona mensagem parada há mais de 10 min. O teto de redisparos (18) conta só
--     redisparos SEGUIDOS SEM PROGRESSO: fn_agente_mensagem_responder zera o contador quando o campo resposta muda.
--     Ao bater o teto continua o alerta único ao Eng. Chefe.
-- (D) Trava de uma sessão por agente (lease): fn_agente_sessao_iniciar(agente, sessao_ref) → ok | ocupado. Renovada a
--     cada fn_agente_mensagem_responder; expira sozinha após 12 min sem renovação. fn_agente_acionar e o despertador
--     NÃO disparam se houver lease ativa do agente. Só serviço, SECURITY DEFINER, search_path fixo.
-- Nenhuma função de guarda é alterada (RD-91). Definições vivas lidas com pg_get_functiondef antes do patch.

CREATE TABLE IF NOT EXISTS public.erp_agente_sessao_lease (
  agente       text PRIMARY KEY REFERENCES public.erp_agente_rotina(agente),
  sessao_ref   text NOT NULL,
  iniciada_em  timestamptz NOT NULL DEFAULT now(),
  renovada_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_agente_sessao_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_agente_sessao_lease FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_agente_sessao_lease TO service_role;

CREATE OR REPLACE FUNCTION public.fn_agente_sessao_iniciar(p_agente text, p_sessao_ref text, p_validade interval DEFAULT interval '12 minutes')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ref text;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  IF NULLIF(btrim(COALESCE(p_sessao_ref, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_ref_obrigatoria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_rotina WHERE agente = p_agente) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agente_desconhecido');
  END IF;
  -- atômico: o upsert só vence se não há lease ativa de OUTRA sessão
  INSERT INTO erp_agente_sessao_lease AS l (agente, sessao_ref, iniciada_em, renovada_em)
  VALUES (p_agente, p_sessao_ref, now(), now())
  ON CONFLICT (agente) DO UPDATE
     SET sessao_ref  = EXCLUDED.sessao_ref,
         iniciada_em = CASE WHEN l.sessao_ref = EXCLUDED.sessao_ref THEN l.iniciada_em ELSE now() END,
         renovada_em = now()
   WHERE l.sessao_ref = EXCLUDED.sessao_ref OR l.renovada_em < now() - p_validade
  RETURNING sessao_ref INTO v_ref;
  IF v_ref IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'ocupado', 'agente', p_agente);
  END IF;
  RETURN jsonb_build_object('ok', true, 'resultado', 'ok', 'agente', p_agente, 'sessao_ref', v_ref);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn__agente_lease_ativa(p_agente text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM erp_agente_sessao_lease WHERE agente = p_agente AND renovada_em > now() - interval '12 minutes');
$function$;

-- fn_agente_acionar: não dispara com lease ativa (e não mexe na mensagem, para não adiar o despertador)
CREATE OR REPLACE FUNCTION public.fn_agente_acionar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_url text; v_token text; v_req bigint; v_res jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT msg.*, r.aciona INTO m
    FROM erp_agente_mensagem msg JOIN erp_agente_rotina r ON r.agente = msg.para
   WHERE msg.id = p_mensagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  IF public.fn__agente_lease_ativa(m.para) THEN
    RETURN jsonb_build_object('ok', true, 'em', now(), 'acionou', false, 'motivo', 'sessao_ativa');
  END IF;

  IF m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'aguarda_ok_ceo');
  ELSIF NOT m.aciona THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'agente_sem_acionamento');
  ELSE
    SELECT decrypted_secret INTO v_url   FROM vault.decrypted_secrets WHERE name = 'agente_rotina_url_'   || m.para;
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'agente_rotina_token_' || m.para;
    IF v_url IS NULL OR v_token IS NULL THEN
      v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'rotina_nao_configurada_no_cofre');
    ELSE
      SELECT net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'Authorization',     'Bearer ' || v_token,
          'anthropic-beta',    'experimental-cc-routine-2026-04-01',
          'anthropic-version', '2023-06-01'),
        body    := jsonb_build_object('text',
          'Nova mensagem ' || m.id::text || ' na caixa de ' || m.para || ' (de ' || m.de || '). '
          || 'Leia pelo canal protegido: SELECT fn_agente_caixa(''' || m.para || ''');'),
        timeout_milliseconds := 15000
      ) INTO v_req;
      v_res := jsonb_build_object('em', now(), 'acionou', true, 'request_id', v_req);
    END IF;
  END IF;

  UPDATE erp_agente_mensagem SET acionamento = v_res, atualizado_em = now() WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true) || v_res;
END;
$function$;

-- fn_agente_mensagem_responder: renova o lease e zera os redisparos quando a resposta (progresso) muda
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_responder(p_mensagem_id uuid, p_agente text, p_status text, p_resposta text DEFAULT NULL::text, p_pr_numero integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.para <> p_agente THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_de_outro_agente'); END IF;
  IF p_status NOT IN ('em_andamento','concluida','recusada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;
  IF m.status IN ('concluida','recusada') THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF p_status IN ('em_andamento','concluida') AND m.tipo = 'tarefa' AND m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aguarda_ok_ceo');
  END IF;
  IF p_status IN ('concluida','recusada') AND NULLIF(btrim(COALESCE(p_resposta, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_obrigatoria');
  END IF;
  UPDATE erp_agente_mensagem SET
    status        = p_status,
    resposta      = COALESCE(NULLIF(btrim(COALESCE(p_resposta, '')), ''), resposta),
    pr_numero     = COALESCE(p_pr_numero, pr_numero),
    recebida_em   = COALESCE(recebida_em, now()),
    iniciada_em   = CASE WHEN p_status = 'em_andamento' THEN COALESCE(iniciada_em, now()) ELSE iniciada_em END,
    concluida_em  = CASE WHEN p_status IN ('concluida','recusada') THEN now() ELSE concluida_em END,
    -- progresso (resposta nova) zera o contador de redisparos seguidos sem progresso
    redisparos    = CASE WHEN COALESCE(NULLIF(btrim(COALESCE(p_resposta, '')), ''), resposta) IS DISTINCT FROM resposta THEN 0 ELSE redisparos END,
    alerta_teto_em = CASE WHEN COALESCE(NULLIF(btrim(COALESCE(p_resposta, '')), ''), resposta) IS DISTINCT FROM resposta THEN NULL ELSE alerta_teto_em END,
    atualizado_em = now()
  WHERE id = p_mensagem_id;
  UPDATE erp_agente_sessao_lease SET renovada_em = now() WHERE agente = p_agente;  -- renova a vez da sessão ativa
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id, 'status', p_status);
END;
$function$;

-- despertador: limiar 10 min, teto 18 (seguidos sem progresso), respeita lease ativa
CREATE OR REPLACE FUNCTION public.fn_agente_despertador(p_parado interval DEFAULT interval '10 minutes',
                                                        p_teto integer DEFAULT 18,
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

  -- (1) bateu o teto de redisparos seguidos sem progresso: para e avisa o Eng. Chefe, uma vez só
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
            || m.redisparos || ' vezes seguidas sem progresso e continua parada. O despertador parou (teto de ' || p_teto || '). '
            || 'Ação do Eng. Chefe: ver a sessão da rotina, responder/arquivar a mensagem ou reenviar.',
            jsonb_build_object('mensagem_id', m.id, 'agente', m.para, 'teto', p_teto),
            'agente_despertador', ARRAY['alerta','despertador']);
    UPDATE erp_agente_mensagem SET alerta_teto_em = now() WHERE id = m.id;
    v_alertas := v_alertas + 1;
  END LOOP;

  -- (2) um disparo por agente com acionamento ligado e SEM lease ativa: a mais antiga, executável, parada, abaixo do teto
  FOR r IN SELECT agente FROM erp_agente_rotina WHERE aciona ORDER BY agente LOOP
    CONTINUE WHEN public.fn__agente_lease_ativa(r.agente);   -- sessão trabalhando: não dispara outra
    SELECT msg.id, msg.redisparos INTO m
      FROM erp_agente_mensagem msg
     WHERE msg.para = r.agente AND NOT msg.arquivada AND msg.tipo = 'tarefa'
       AND msg.status IN ('recebida','em_andamento')
       AND (NOT msg.requer_ok_ceo OR msg.ok_ceo_em IS NOT NULL)          -- nunca sem o OK do CEO
       AND msg.redisparos < p_teto
       AND msg.atualizado_em < now() - p_parado                          -- parada há mais de 10 min
       AND COALESCE((msg.acionamento->>'em')::timestamptz, '-infinity') < now() - p_parado
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
REVOKE ALL ON FUNCTION public.fn_agente_acionar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_acionar(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_responder(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_responder(uuid, text, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_agente_sessao_iniciar(text, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_sessao_iniciar(text, text, interval) TO service_role;
REVOKE ALL ON FUNCTION public.fn__agente_lease_ativa(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__agente_lease_ativa(text) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agente_despertador') THEN
    PERFORM cron.unschedule('agente_despertador');
  END IF;
  PERFORM cron.schedule('agente_despertador', '*/5 * * * *', 'SELECT public.fn_agente_despertador();');
END
$cron$;
