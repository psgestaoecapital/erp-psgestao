-- Detector de sessão morta (Eng. Chefe 12/10, ref 0cafbe34 + adendos 50255f91 e 18f02091) — o Code se auto-ressuscita.
-- Problemas crônicos achados na auditoria:
--   (1) tarefa fica em_andamento (iniciada_em preenchida, concluida_em NULL) para sempre quando a sessão morre;
--   (2) lease FANTASMA: a lease da sessão morta bloqueia fn_agente_acionar ("sessao_ativa") e a fila não anda.
-- O que faz (rodada de 5 em 5 min, pg_cron, só conexão de serviço):
--   A. lease fantasma = lease sem renovar há > 10 min E o agente tem tarefa executável esperando -> remove a lease
--      e aciona a tarefa pendente mais antiga (acorda sessão nova). Sessão viva renova a lease a cada resposta,
--      então heartbeat recente nunca é tocado.
--   B. tarefa órfã = em_andamento, iniciada, não concluída, parada > 15 min, agente SEM lease ativa, iniciada há
--      <= 24 h -> volta para 'recebida' (iniciada_em NULL) para a sessão viva re-pegar. Não mexe em "aguardando".
--   C. fóssil = em_andamento há > 24 h: NÃO é mexido. Vira UM alerta ao Eng. Chefe/CEO (por dia) com a lista, para
--      decidir (arquivar abandonadas, re-enfileirar as que importam) — fn_agente_fossil_listar() devolve a lista.
--   D. toda ação grava o racional em erp_agente_detector_log.
-- TTL da lease (12 min em fn__agente_lease_ativa) mantido: a lease fantasma agora é limpa aos 10 min de silêncio,
-- sem encurtar o TTL global (que derrubaria sessão viva em tarefa longa).
-- Função de guarda não é alterada (RD-91). Nenhum dado de cliente.

CREATE TABLE IF NOT EXISTS public.erp_agente_detector_log (
  id          bigserial PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  acao        text NOT NULL CHECK (acao IN ('lease_fantasma_limpa','tarefa_reenfileirada','fossil_alerta','acionou')),
  agente      text,
  mensagem_id uuid,
  racional    jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.erp_agente_detector_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_agente_detector_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.erp_agente_detector_log_id_seq FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS erp_agente_detector_log_em_idx ON public.erp_agente_detector_log (em DESC);

CREATE OR REPLACE FUNCTION public.fn_agente_fossil_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', m.id, 'agente', m.para, 'tipo', m.tipo, 'assunto', m.assunto,
             'iniciada_em', m.iniciada_em, 'atualizado_em', m.atualizado_em, 'pr_numero', m.pr_numero)
           ORDER BY m.iniciada_em)
      FROM erp_agente_mensagem m
     WHERE m.status = 'em_andamento' AND NOT m.arquivada AND m.concluida_em IS NULL
       AND m.iniciada_em < now() - interval '24 hours'), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_agente_detectar_sessao_morta(p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; m record; v_res jsonb;
  v_leases jsonb := '[]'::jsonb; v_reenf jsonb := '[]'::jsonb; v_fossil jsonb; v_nfossil int;
BEGIN
  PERFORM public.fn__agente_assert_servico();

  -- A. lease FANTASMA: sem renovar há > 10 min e com tarefa executável esperando
  FOR r IN
    SELECT l.agente, l.sessao_ref, l.renovada_em
      FROM erp_agente_sessao_lease l
      JOIN erp_agente_rotina ro ON ro.agente = l.agente AND ro.aciona
     WHERE l.renovada_em < now() - interval '10 minutes'
       AND EXISTS (SELECT 1 FROM erp_agente_mensagem x
                    WHERE x.para = l.agente AND x.tipo = 'tarefa' AND NOT x.arquivada
                      AND x.status IN ('recebida','em_andamento')
                      AND (NOT x.requer_ok_ceo OR x.ok_ceo_em IS NOT NULL)
                      AND x.aguardando_motivo IS NULL)
  LOOP
    SELECT x.id, x.assunto INTO m
      FROM erp_agente_mensagem x
     WHERE x.para = r.agente AND x.tipo = 'tarefa' AND NOT x.arquivada
       AND x.status IN ('recebida','em_andamento')
       AND (NOT x.requer_ok_ceo OR x.ok_ceo_em IS NOT NULL)
       AND x.aguardando_motivo IS NULL
     ORDER BY x.criado_em LIMIT 1;

    v_leases := v_leases || jsonb_build_array(jsonb_build_object('agente', r.agente, 'sessao_ref', r.sessao_ref,
                  'renovada_em', r.renovada_em, 'mensagem_id', m.id));
    CONTINUE WHEN p_simular;

    DELETE FROM erp_agente_sessao_lease WHERE agente = r.agente AND sessao_ref = r.sessao_ref AND renovada_em = r.renovada_em;
    INSERT INTO erp_agente_detector_log (acao, agente, mensagem_id, racional)
    VALUES ('lease_fantasma_limpa', r.agente, m.id,
            jsonb_build_object('sessao_ref', r.sessao_ref, 'renovada_em', r.renovada_em,
              'motivo', 'lease sem renovar há > 10 min com tarefa esperando; bloquearia fn_agente_acionar (sessao_ativa)'));
    BEGIN
      v_res := public.fn_agente_acionar(m.id) - 'ok';
      INSERT INTO erp_agente_detector_log (acao, agente, mensagem_id, racional)
      VALUES ('acionou', r.agente, m.id, jsonb_build_object('resultado', v_res));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO erp_agente_detector_log (acao, agente, mensagem_id, racional)
      VALUES ('acionou', r.agente, m.id, jsonb_build_object('erro', SQLERRM));
    END;
  END LOOP;

  -- B. tarefa ÓRFÃ: em_andamento, parada > 15 min, agente sem lease ativa, iniciada há <= 24 h -> volta para a fila
  FOR m IN
    SELECT x.id, x.para, x.assunto, x.iniciada_em, x.atualizado_em
      FROM erp_agente_mensagem x
     WHERE x.tipo = 'tarefa' AND x.status = 'em_andamento' AND NOT x.arquivada
       AND x.iniciada_em IS NOT NULL AND x.concluida_em IS NULL
       AND x.iniciada_em >= now() - interval '24 hours'
       AND x.atualizado_em < now() - interval '15 minutes'
       AND x.aguardando_motivo IS NULL
       AND NOT public.fn__agente_lease_ativa(x.para)
     ORDER BY x.iniciada_em
     LIMIT 50
       FOR UPDATE SKIP LOCKED
  LOOP
    v_reenf := v_reenf || jsonb_build_array(jsonb_build_object('mensagem_id', m.id, 'agente', m.para, 'assunto', m.assunto));
    CONTINUE WHEN p_simular;
    UPDATE erp_agente_mensagem SET status = 'recebida', iniciada_em = NULL, atualizado_em = now() WHERE id = m.id;
    INSERT INTO erp_agente_detector_log (acao, agente, mensagem_id, racional)
    VALUES ('tarefa_reenfileirada', m.para, m.id,
            jsonb_build_object('assunto', m.assunto, 'iniciada_em', m.iniciada_em, 'atualizado_em', m.atualizado_em,
              'motivo', 'sessão morta: em_andamento sem concluir, parada > 15 min e sem lease ativa; volta para recebida'));
  END LOOP;

  -- C. FÓSSIL (> 24 h): não mexe; um alerta por dia ao Eng. Chefe/CEO com a lista
  v_fossil := public.fn_agente_fossil_listar();
  v_nfossil := jsonb_array_length(v_fossil);
  IF v_nfossil > 0 AND NOT p_simular
     AND NOT EXISTS (SELECT 1 FROM erp_contexto_projeto
                      WHERE projeto = 'agentes_caixa' AND criado_por = 'agente_detector'
                        AND criado_em > now() - interval '24 hours') THEN
    INSERT INTO erp_contexto_projeto (projeto, categoria, prioridade, titulo, descricao, refs, criado_por, tags)
    VALUES ('agentes_caixa', 'pendencia', 'alta',
            'FÓSSEIS: ' || v_nfossil || ' tarefa(s) em_andamento há mais de 24 h nas caixas dos Codes',
            'Tarefas iniciadas há mais de 24 h e nunca concluídas. O detector NÃO as altera. Decidir: arquivar as abandonadas, '
            || 're-enfileirar (status recebida) as que ainda importam (ex.: HB1 FC, ondas GE). Lista: SELECT fn_agente_fossil_listar();',
            jsonb_build_object('total', v_nfossil), 'agente_detector', ARRAY['alerta','detector','fossil']);
    INSERT INTO erp_agente_detector_log (acao, racional) VALUES ('fossil_alerta', jsonb_build_object('total', v_nfossil));
  END IF;

  RETURN jsonb_build_object('ok', true, 'simulado', p_simular, 'leases_fantasma', v_leases,
                            'reenfileiradas', v_reenf, 'fosseis', v_nfossil);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_fossil_listar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_detectar_sessao_morta(boolean) FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agente_detector_sessao_morta') THEN
    PERFORM cron.unschedule('agente_detector_sessao_morta');
  END IF;
  PERFORM cron.schedule('agente_detector_sessao_morta', '*/5 * * * *', 'SELECT public.fn_agente_detectar_sessao_morta();');
END
$cron$;
