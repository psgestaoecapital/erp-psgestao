-- Despertador econômico: TETO HORÁRIO explícito (CEO 22/10 — "faz conforme sua orientação")
--
-- Contexto (contenção de crédito 20/10): a frota de Codes queimou ~R$2.000 porque 9 crons de
-- "plantão" de 5 min por agente (revisor-pendencias-5min, jordana-chamados-5min, esteira-dono-5min,
-- auditor-pos-merge-5min, produto-hub-plantao, etc.) acordavam a frota inteira a cada poucos minutos,
-- SEM recuo. Todos foram desligados e NÃO voltam.
--
-- O `fn_agente_despertador` (cron `agente_despertador`, */30, hoje DESLIGADO) é o caminho econômico e
-- correto para os Codes se auto-acionarem: um disparo por agente, só quem NÃO tem sessão ativa e tem
-- tarefa executável de verdade parada, com recuo 30 min → 1 h → 2 h → 4 h e teto de 6 redisparos
-- (depois alerta o Eng. Chefe e para). Como o loop é "um por agente que aciona", ele já está limitado
-- a ~8 acionamentos por rodada (estrutural); a */30 isso dá no máximo ~16/h, e o recuo derruba bem abaixo.
--
-- Esta migration adiciona a trava explícita que faltava para religá-lo com segurança: um TETO HORÁRIO
-- duro (p_teto_hora, padrão 12), medido por um LEDGER DE PULSO leve e indexado — NÃO por varredura do
-- acionamento_historico (8,6 mil mensagens, até 327 entradas cada: seria justamente o "scan/função em
-- volume" que derrubou o banco em 03/10). Cada acionamento real grava um pulso; a contagem da última
-- hora é um index-scan O(nº de pulsos na hora) ≤ teto. Batido o teto, o despertador para de acionar na
-- rodada e devolve `teto_hora_atingido`. Mesmo num cenário patológico, nunca passa de p_teto_hora/h.
--
-- NÃO religa o cron: a função só passa a valer quando o CEO religar o job 71 (decisão dele, pós-OK).

-- Ledger de pulso: uma linha por acionamento real do despertador. Aditiva, RLS ligada, só serviço.
CREATE TABLE IF NOT EXISTS public.erp_despertador_pulso (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  agente      text,
  mensagem_id uuid
);
CREATE INDEX IF NOT EXISTS ix_despertador_pulso_em ON public.erp_despertador_pulso (em);
ALTER TABLE public.erp_despertador_pulso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_despertador_pulso FROM anon, authenticated;
-- sem policy para anon/authenticated: só o canal de serviço (SECURITY DEFINER) grava e lê.

-- Adicionar o 5º parâmetro muda a assinatura: um CREATE OR REPLACE sozinho criaria um OVERLOAD
-- (ficariam a versão de 4 e a de 5 args), e o cron `SELECT fn_agente_despertador()` viraria ambíguo.
-- Por isso removemos primeiro a assinatura antiga; depois o no-arg resolve só na versão nova.
DROP FUNCTION IF EXISTS public.fn_agente_despertador(interval, integer, uuid, boolean);

CREATE OR REPLACE FUNCTION public.fn_agente_despertador(
  p_parado    interval DEFAULT '00:30:00'::interval,
  p_teto      integer  DEFAULT 6,
  p_somente   uuid     DEFAULT NULL::uuid,
  p_simular   boolean  DEFAULT false,
  p_teto_hora integer  DEFAULT 12
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; m record; v_res jsonb; v_disparos jsonb := '[]'::jsonb; v_alertas int := 0;
  v_max interval := interval '4 hours';
  v_na_hora int := 0;          -- acionamentos reais do despertador na última hora (pelo ledger)
  v_teto_hora_atingido bool := false;
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

  -- Limpeza oportunista do ledger (mantém só as últimas 2 h) e TETO HORÁRIO: quantos acionamentos
  -- reais já saíram na última hora. Index-scan em ix_despertador_pulso_em; custo O(pulsos na hora).
  DELETE FROM erp_despertador_pulso WHERE em < now() - interval '2 hours';
  SELECT count(*) INTO v_na_hora FROM erp_despertador_pulso WHERE em > now() - interval '1 hour';

  -- (2) um disparo por agente com acionamento ligado e SEM lease ativa: a mais antiga, executável,
  --     parada pelo recuo (30 min, 1 h, 2 h, 4 h), abaixo do teto e sem marca "aguardando".
  --     Respeita o TETO HORÁRIO: para de acionar assim que v_na_hora alcança p_teto_hora.
  FOR r IN SELECT agente FROM erp_agente_rotina WHERE aciona ORDER BY agente LOOP
    IF v_na_hora >= p_teto_hora THEN v_teto_hora_atingido := true; EXIT; END IF;
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

    -- só o disparo que de fato acionou a rotina grava pulso e conta no teto horário
    IF COALESCE((v_res->>'acionou')::boolean, false) THEN
      INSERT INTO erp_despertador_pulso (agente, mensagem_id) VALUES (r.agente, m.id);
      v_na_hora := v_na_hora + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'disparos', v_disparos,
    'alertas_teto', v_alertas,
    'acionamentos_na_hora', v_na_hora,
    'teto_hora', p_teto_hora,
    'teto_hora_atingido', v_teto_hora_atingido
  );
END;
$function$;

-- Grants: o DROP+CREATE faz a função nova nascer com EXECUTE para PUBLIC (padrão). A guarda
-- fn__agente_assert_servico() já barra, mas restauramos a ACL restrita da assinatura antiga
-- ({postgres, service_role}) para não perder a defesa em profundidade (revisão do gilberto-revisor).
REVOKE ALL ON FUNCTION public.fn_agente_despertador(interval, integer, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_despertador(interval, integer, uuid, boolean, integer) TO service_role;
