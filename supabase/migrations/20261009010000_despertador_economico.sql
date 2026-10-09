-- Despertador econômico (CEO 08/10 21:45 "pode corrigir o despertador"). Faixa 00 (gilberto-desenv). Aditiva.
-- Definição viva de fn_agente_despertador lida com pg_get_functiondef antes de reescrever.
-- 1) Mensagem NOVA continua acionando na hora pelo gatilho de envio (nada muda nele).
-- 2) Redisparo só se nada mudou há p_parado (30 min) com recuo exponencial por redisparo seguido sem progresso:
--    30 min, 1 h, 2 h, 4 h (teto); teto de 6 redisparos antes do alerta ao Eng. Chefe. Progresso (resposta nova,
--    mensagem atualizada) zera o contador como já fazia fn_agente_mensagem_responder e atualiza atualizado_em.
-- 3) "Aguardando": a sessão marca a mensagem com motivo externo (revisor, CEO, outra PR); o despertador não
--    redispara enquanto o motivo valer; mudança de status/resposta/PR da mensagem limpa a marca sozinha.
-- 4) Relatório de sessões abertas nas últimas 24 h por agente (fn_agente_sessoes_24h) para o card da aba Codes.
-- Nenhuma função de guarda é alterada (RD-91).

ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS aguardando_motivo text;
ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS aguardando_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_aguardar(p_id uuid, p_agente text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  UPDATE erp_agente_mensagem
     SET aguardando_motivo = NULLIF(btrim(p_motivo), ''),
         aguardando_em = CASE WHEN NULLIF(btrim(p_motivo), '') IS NULL THEN NULL ELSE now() END
   WHERE id = p_id AND para = p_agente;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0, 'id', p_id, 'aguardando', NULLIF(btrim(p_motivo), ''));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_aguardar(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_aguardar(uuid, text, text) TO service_role;

-- a marca "aguardando" cai sozinha quando a mensagem muda de verdade (status, resposta ou PR)
CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_limpa_aguardando()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.aguardando_motivo IS NOT NULL
     AND NEW.aguardando_motivo IS NOT DISTINCT FROM OLD.aguardando_motivo
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.resposta IS DISTINCT FROM OLD.resposta
          OR NEW.pr_numero IS DISTINCT FROM OLD.pr_numero) THEN
    NEW.aguardando_motivo := NULL;
    NEW.aguardando_em := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_agente_mensagem_limpa_aguardando ON public.erp_agente_mensagem;
CREATE TRIGGER trg_agente_mensagem_limpa_aguardando BEFORE UPDATE ON public.erp_agente_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn__agente_mensagem_limpa_aguardando();

CREATE OR REPLACE FUNCTION public.fn_agente_despertador(p_parado interval DEFAULT interval '30 minutes', p_teto integer DEFAULT 6, p_somente uuid DEFAULT NULL::uuid, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; m record; v_res jsonb; v_disparos jsonb := '[]'::jsonb; v_alertas int := 0;
  v_max interval := interval '4 hours';
BEGIN
  PERFORM public.fn__agente_assert_servico();

  -- (1) bateu o teto de redisparos seguidos sem progresso: para e avisa o Eng. Chefe, uma vez só
  FOR m IN
    SELECT msg.id, msg.para, msg.assunto, msg.redisparos
      FROM erp_agente_mensagem msg JOIN erp_agente_rotina ro ON ro.agente = msg.para
     WHERE ro.aciona AND NOT msg.arquivada AND msg.tipo = 'tarefa'
       AND msg.status IN ('recebida','em_andamento')
       AND (NOT msg.requer_ok_ceo OR msg.ok_ceo_em IS NOT NULL)
       AND msg.aguardando_motivo IS NULL
       AND msg.redisparos >= p_teto AND msg.alerta_teto_em IS NULL
       AND (p_somente IS NULL OR msg.id = p_somente)
       AND msg.atualizado_em < now() - least(p_parado * power(2, msg.redisparos), v_max)
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

  -- (2) um disparo por agente com acionamento ligado e SEM lease ativa: a mais antiga, executável, parada
  --     pelo tempo do recuo (30 min, 1 h, 2 h, 4 h), abaixo do teto e sem marca "aguardando"
  FOR r IN SELECT agente FROM erp_agente_rotina WHERE aciona ORDER BY agente LOOP
    CONTINUE WHEN public.fn__agente_lease_ativa(r.agente);
    SELECT msg.id, msg.redisparos INTO m
      FROM erp_agente_mensagem msg
     WHERE msg.para = r.agente AND NOT msg.arquivada AND msg.tipo = 'tarefa'
       AND msg.status IN ('recebida','em_andamento')
       AND (NOT msg.requer_ok_ceo OR msg.ok_ceo_em IS NOT NULL)
       AND msg.aguardando_motivo IS NULL
       AND msg.redisparos < p_teto
       AND msg.atualizado_em < now() - least(p_parado * power(2, msg.redisparos), v_max)
       AND COALESCE((msg.acionamento->>'em')::timestamptz, '-infinity') < now() - least(p_parado * power(2, msg.redisparos), v_max)
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

-- relatório: acionamentos (sessões abertas) por agente nas últimas 24 h, pelo histórico de cada mensagem
CREATE OR REPLACE FUNCTION public.fn_agente_sessoes_24h()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT COALESCE(jsonb_object_agg(para, n), '{}'::jsonb) INTO v FROM (
    SELECT msg.para, count(*) AS n
      FROM erp_agente_mensagem msg, jsonb_array_elements(msg.acionamento_historico) h
     WHERE msg.atualizado_em > now() - interval '25 hours'
       AND (h->>'em')::timestamptz > now() - interval '24 hours'
     GROUP BY msg.para) t;
  RETURN jsonb_build_object('ok', true, 'janela_horas', 24, 'sessoes_por_agente', v);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_sessoes_24h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_sessoes_24h() TO service_role;
