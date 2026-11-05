-- Conserto do roteador de chamados fn_chamados_rotear (CEO 05/11).
-- BUG 1 (filtro rigido): deixar de depender do padrao de TITULO ('CHAMADO #%').
--   - Varre chamado ABERTO pelo STATUS (nova / em_analise / em_desenvolvimento) e pela
--     existencia em sugestoes; o em_desenvolvimento ficava invisivel ao roteador.
--   - Devolucao de tarefa parada: identifica a tarefa de chamado pela coluna sugestao_id
--     (nao pelo assunto LIKE 'CHAMADO #%'), para nao perder tarefa com titulo diferente.
--   - Deduplicacao: confere tarefa aberta do MESMO chamado por sugestao_id / chamado_numero
--     (colunas), nao pelo texto do assunto.
-- BUG 2 (frequencia): reagenda o cron de fn_chamados_rotear para ~20 min (era 1h).
--   Reagendamento guardado (nunca derruba a migration se o papel nao puder mexer no cron) —
--   revisao-eng-chefe/CEO autoriza o merge; descrito na PR (CEO 05/11).
-- MANTIDO: distribuicao por MENOR FILA (fn_dev_mais_vazio) e a trava que SEGURA os
--   sensiveis (fiscal/financeiro) sem roteamento automatico.
-- Aditivo: CREATE OR REPLACE (sem alterar dado de cliente). Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_chamados_rotear(p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record; m record; v_dev text; v_res jsonb; v_msg uuid;
  v_rot int := 0; v_sens int := 0; v_dev_n int := 0; v_sem int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_chamados_rotear é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  -- Devolução: tarefa de chamado aberta há > 24 h em dev pausado/fora do papel ou sem atividade em 2 h volta ao grupo.
  -- Identificada pela coluna sugestao_id (robusto a qualquer título), não pelo padrão 'CHAMADO #%'.
  FOR m IN
    SELECT x.id, x.sugestao_id, x.assunto
      FROM public.erp_agente_mensagem x
     WHERE x.sugestao_id IS NOT NULL
       AND x.status IN ('nova', 'recebida', 'em_andamento')
       AND coalesce(x.arquivada, false) = false
       AND x.criado_em < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.erp_agente_papel p
          WHERE p.agente = x.para AND p.papel = 'dev_hub' AND NOT p.pausado
            AND (
              EXISTS (SELECT 1 FROM public.erp_dev_entrega e WHERE e.code = p.agente AND e.ocorrido_em > now() - interval '2 hours')
              OR EXISTS (SELECT 1 FROM public.erp_agente_mensagem y
                          WHERE y.para = p.agente AND y.id <> x.id
                            AND greatest(y.recebida_em, y.iniciada_em, y.concluida_em) > now() - interval '2 hours')
              OR EXISTS (SELECT 1 FROM public.erp_agente_sessao_lease l
                          WHERE l.agente = p.agente AND l.renovada_em > now() - interval '2 hours'
                            AND l.renovada_em >= l.iniciada_em)
              OR greatest(x.recebida_em, x.iniciada_em, x.atualizado_em) > now() - interval '2 hours'
            )
       )
  LOOP
    PERFORM public.fn_agente_mensagem_arquivar(m.id);
    IF m.sugestao_id IS NOT NULL THEN
      UPDATE public.sugestoes SET agente = NULL, em_atendimento_desde = NULL WHERE id = m.sugestao_id;
    END IF;
    v_dev_n := v_dev_n + 1;
  END LOOP;

  -- Candidatos: todo chamado ABERTO (por STATUS) sem dono, roteado por menor fila.
  -- (sensíveis são contados e pulados; o limite vale só para os efetivamente roteados).
  FOR c IN
    SELECT s.id, s.numero, s.titulo, s.descricao, s.area, s.categoria, s.rota, s.prioridade,
           EXISTS (SELECT 1 FROM public.erp_chamado_regra_sensivel r
                    WHERE r.ativo
                      AND (s.titulo ILIKE '%' || r.padrao || '%' OR s.descricao ILIKE '%' || r.padrao || '%'
                           OR s.area ILIKE '%' || r.padrao || '%' OR s.categoria ILIKE '%' || r.padrao || '%')) AS sensivel
      FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento')
       AND coalesce(s.interno, false) = false
       AND s.numero IS NOT NULL
       AND public.fn_chamado_agente_dono(s.id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE (t.sugestao_id = s.id OR t.chamado_numero = s.numero)
                          AND t.status IN ('nova', 'recebida', 'em_andamento')
                          AND coalesce(t.arquivada, false) = false)
       AND ( (s.agente IS NULL AND s.responsavel_id IS NULL)
          OR (s.agente IS NOT NULL
              AND s.agente NOT IN (SELECT p.agente FROM public.erp_agente_papel p WHERE p.papel = 'dev_hub' AND NOT p.pausado)
              AND s.agente NOT IN (SELECT d.agente FROM public.erp_agente_dono d WHERE d.ativo))
          OR s.responsavel_id IS NOT NULL )
       AND NOT (s.area = 'hub_projetos' AND EXISTS (
              SELECT 1 FROM public.hub_tela_dono h WHERE s.rota LIKE h.rota_prefixo || '%'))
     ORDER BY s.created_at
     LIMIT 200
  LOOP
    IF c.sensivel THEN
      v_sens := v_sens + 1;
      CONTINUE;
    END IF;
    EXIT WHEN v_rot >= p_limite;

    v_dev := public.fn_dev_mais_vazio();
    IF v_dev IS NULL THEN
      v_sem := v_sem + 1;
      EXIT;
    END IF;

    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado aberto que ninguém trabalha (roteador, decisão do CEO 28/10).' || E'\n'
      || 'Chamado: #' || c.numero || ' (id ' || c.id || ')' || E'\n'
      || 'Rota: ' || coalesce(c.rota, '—') || E'\n'
      || 'Área: ' || coalesce(c.area, '—') || ' · Prioridade: ' || coalesce(c.prioridade::text, '—') || E'\n'
      || '(LGPD: título e descrição do cliente NÃO são copiados para a fila; leia pelo id em sugestoes.)' || E'\n\n'
      || 'Regras: PR pequena, com "Code: ' || v_dev || '" no corpo. A resposta ao cliente só sai por '
      || 'fn_agente_chamado_responder, com OK do CEO. Não conclua esta tarefa antes de resolver o chamado.',
      false, 'eng_chefe');

    v_msg := (v_res ->> 'id')::uuid;
    UPDATE public.erp_agente_mensagem SET sugestao_id = c.id, chamado_numero = c.numero WHERE id = v_msg;
    UPDATE public.sugestoes SET agente = v_dev, em_atendimento_desde = now(), ultimo_movimento = now() WHERE id = c.id;
    v_rot := v_rot + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteados', v_rot, 'sensiveis', v_sens, 'devolvidos', v_dev_n,
                            'sem_dev_vivo', v_sem, 'em', now());
END;
$function$;

-- BUG 2 — frequência: reagenda o cron de fn_chamados_rotear para a cada 20 min.
-- Guardado: nunca derruba a migration se o papel do deploy não puder alterar cron.
DO $cron$
DECLARE j bigint;
BEGIN
  SELECT jobid INTO j FROM cron.job WHERE command ILIKE '%fn_chamados_rotear%' ORDER BY jobid LIMIT 1;
  IF j IS NOT NULL THEN
    PERFORM cron.alter_job(j, schedule => '*/20 * * * *');
    RAISE NOTICE 'cron fn_chamados_rotear reagendado para */20 (jobid %)', j;
  ELSE
    RAISE NOTICE 'cron fn_chamados_rotear nao encontrado; reagende manualmente para */20';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron reschedule nao aplicado (sem privilegio?): %', SQLERRM;
END
$cron$;
