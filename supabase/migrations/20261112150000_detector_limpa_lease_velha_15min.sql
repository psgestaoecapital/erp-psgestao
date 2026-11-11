-- Lease zumbi (CEO 10/11): o detector só limpava lease FANTASMA (> 10 min E com tarefa esperando).
-- Uma lease velha que NÃO bloqueia tarefa naquele tick sobrevivia (ex.: lease da jordana de ONTEM, ~24 h
-- sem renovar). Agora o detector limpa TODA lease não renovada há > 15 min, bloqueando tarefa ou não —
-- lease > 15 min nunca é "viva" (lease viva = renovada há <= 12 min), então remover é seguro e impede que
-- lease velha sobre e atrapalhe fn_agente_acionar de uma próxima sessão.
--
-- Mantém intactos: loop A (fantasma > 10 min COM tarefa -> limpa + re-aciona), loop B (tarefa órfã
-- re-enfileirada) e loop C (alerta de fósseis). Acrescenta o passo A2 (varre lease velha > 15 min) e a
-- chave de retorno 'leases_velhas_limpas'.
--
-- Prova RD-38 (após rodar em produção, não simular): SELECT count(*) FROM erp_agente_sessao_lease
--   WHERE renovada_em < now() - interval '15 minutes'  ==> 0.

CREATE OR REPLACE FUNCTION public.fn_agente_detectar_sessao_morta(p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; m record; v_res jsonb;
  v_leases jsonb := '[]'::jsonb; v_reenf jsonb := '[]'::jsonb; v_fossil jsonb; v_nfossil int;
  v_lv int := 0; v_lv_list jsonb := '[]'::jsonb;
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

  -- A2 (CEO 10/11). TODA lease não renovada há > 15 min é MORTA -> remove, bloqueie tarefa ou não.
  -- (As que tinham tarefa e >10 min já saíram no loop A; aqui pega o resto, inclusive sem tarefa.)
  FOR r IN
    SELECT l.agente, l.sessao_ref, l.renovada_em
      FROM erp_agente_sessao_lease l
     WHERE l.renovada_em < now() - interval '15 minutes'
  LOOP
    v_lv := v_lv + 1;
    v_lv_list := v_lv_list || jsonb_build_array(jsonb_build_object('agente', r.agente, 'sessao_ref', r.sessao_ref, 'renovada_em', r.renovada_em));
    CONTINUE WHEN p_simular;
    DELETE FROM erp_agente_sessao_lease WHERE agente = r.agente AND sessao_ref = r.sessao_ref AND renovada_em = r.renovada_em;
    INSERT INTO erp_agente_detector_log (acao, agente, racional)
    VALUES ('lease_velha_limpa', r.agente,
            jsonb_build_object('sessao_ref', r.sessao_ref, 'renovada_em', r.renovada_em,
              'motivo', 'lease não renovada há > 15 min: morta, removida (CEO 10/11)'));
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
                            'leases_velhas_limpas', v_lv, 'leases_velhas', v_lv_list,
                            'reenfileiradas', v_reenf, 'fosseis', v_nfossil);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_detectar_sessao_morta(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_detectar_sessao_morta(boolean) TO service_role;
