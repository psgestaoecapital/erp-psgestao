-- Agentes v3 (CEO 05/10). Aditiva. Faixa de migration 00 (gilberto-desenv).
-- 1) Novo agente gilberto-produto (faixa 05): entra nos CHECKs da rotina e da mensagem (pode receber tarefa) e em
--    erp_agente_rotina com aciona=true. Rotina e segredos agente_rotina_url_/token_gilberto-produto já estão no cofre.
-- 2) fn_agente_sessao_encerrar(agente, sessao_ref): libera o lease na hora (só da própria sessão); só serviço.
-- 3) Despertador: p_parado padrão 5 min (era 10). Cron continua a cada 5 min. Lease sem renovação continua expirando
--    sozinho em 12 min. Nenhuma função de guarda é alterada (RD-91). Definição viva lida com pg_get_functiondef.

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code']));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados']));

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao)
VALUES ('gilberto-produto', true, 'Desenvolvedor de produto (P&M, Virada 01/11, Oficina); faixa 05')
ON CONFLICT (agente) DO NOTHING;
-- Verticais futuras (CEO 05/10): existem nos checks e na rotina, mas desligadas (aciona=false) até a etapa futura.
INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('gilberto-automotivo', false, 'Desenvolvedor da vertical Automotivo; faixa 15; liga em etapa futura'),
  ('gilberto-industria',  false, 'Desenvolvedor da vertical Indústria; faixa 25; liga em etapa futura')
ON CONFLICT (agente) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_agente_sessao_encerrar(p_agente text, p_sessao_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  -- só libera a vez da PRÓPRIA sessão (a de outra sessão não é derrubada)
  UPDATE erp_agente_sessao_lease SET renovada_em = now() - interval '1 day'
   WHERE agente = p_agente AND sessao_ref = p_sessao_ref;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'agente', p_agente, 'liberada', v_n > 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_sessao_encerrar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_sessao_encerrar(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_agente_despertador(p_parado interval DEFAULT interval '5 minutes', p_teto integer DEFAULT 18, p_somente uuid DEFAULT NULL::uuid, p_simular boolean DEFAULT false)
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
       AND msg.atualizado_em < now() - p_parado                          -- parada há mais de p_parado (5 min)
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
