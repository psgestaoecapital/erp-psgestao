-- Roteador de chamados — INVARIANTE "1 chamado ativo = 1 tarefa ativa na caixa" (CEO 10/11).
--
-- Furo provado (RD-38): 40 chamados ATIVOS (nova/em_analise/em_desenvolvimento) sem tarefa ativa em
-- erp_agente_mensagem. Deles, 34 são de escopo de sócio (fn_chamado_agente_dono <> null) que o roteador
-- EXCLUÍA, + hub_tela_dono + órfãos de agente. O mecanismo de fila de sócio não criava a tarefa, então os
-- Codes diziam "caixa resolvida" enquanto a Jordana via ~40 abertos (Gean/Pdois da carteira dela).
--
-- Correção (CEO 10/11, "SEM carteira — fila única por prioridade, como os devs plenos"):
--  (1) DE-DUP: um chamado com mais de uma tarefa ativa fica com a MAIS ANTIGA; as extras são arquivadas.
--  (2) REDE DE SEGURANÇA: ao fim do roteamento normal, TODO chamado ativo que AINDA está sem tarefa ganha
--      uma, distribuída por MENOS CHEIO entre os Codes vivos (dev_hub exceto gilberto-desenv/desenvolvedor_5_g,
--      + jordana-code + rodrigo-code). Fila única, sem carteira. O furo não volta (roda a cada 20 min no cron).
--  (3) RETROATIVO: a migration chama o roteador uma vez ao aplicar, destravando os 40 agora.
-- Idempotente: a guarda NOT EXISTS por (sugestao_id OU chamado_numero) impede tarefa duplicada.
--
-- Prova RD-38 (ROLLBACK): 40 ativos sem tarefa -> 0; distribuídos por menos-cheio
--   (dev7claudeps +18, desenvolvedor_4_g +13, code-desenvolvedor-3 +6, jordana-code +3, rodrigo-code +0,
--    equilibrando todos para ~28 tarefas); sem duplicata criada; chamado #7050 (4 tarefas antigas) de-duplicado.

-- ci-sem-guarda: fn_chamados_rotear — roteador do CRON/SERVIÇO (exige auth.uid() IS NULL); por desenho grava
-- tarefas na caixa dos Codes e marca o campo agente de sugestoes de TODAS as empresas (fila de dev, não é dado
-- de cliente — título/descrição não são copiados, LGPD). Sem GRANT a usuário; chamada só pela conexão de serviço.
CREATE OR REPLACE FUNCTION public.fn_chamados_rotear(p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record; m record; v_dev text; v_res jsonb; v_msg uuid;
  v_rot int := 0; v_sens int := 0; v_dev_n int := 0; v_sem int := 0; v_sync int := 0;
  v_dedup int := 0; v_rede int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_chamados_rotear é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  -- (0) DE-DUP: 1 chamado ativo = 1 tarefa ativa. Mantém a MAIS ANTIGA, arquiva as extras.
  FOR m IN
    SELECT id FROM (
      SELECT x.id, row_number() OVER (PARTITION BY x.sugestao_id ORDER BY x.criado_em ASC, x.id) AS rn
        FROM public.erp_agente_mensagem x
       WHERE x.sugestao_id IS NOT NULL AND x.status IN ('nova','recebida','em_andamento')
         AND coalesce(x.arquivada,false) = false
    ) t WHERE t.rn > 1
  LOOP
    PERFORM public.fn_agente_mensagem_arquivar(m.id);
    v_dedup := v_dedup + 1;
  END LOOP;

  -- Sincronização A: chamado de sócio (escopo) com agente vazio recebe o dono do escopo (fn_chamado_agente_dono).
  WITH sync_a AS (
    UPDATE public.sugestoes s
       SET agente = d.dono, ultimo_movimento = now()
      FROM (
        SELECT x.id, public.fn_chamado_agente_dono(x.id) AS dono
          FROM public.sugestoes x
         WHERE (x.agente IS NULL OR x.agente = '')
           AND x.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
      ) d
     WHERE s.id = d.id AND d.dono IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_sync FROM sync_a;

  -- Sincronização B: chamado aberto com tarefa de dev em caixa (por id OU por número) e agente vazio recebe o destinatário.
  WITH sync_b AS (
    UPDATE public.sugestoes s
       SET agente = t.para, em_atendimento_desde = coalesce(s.em_atendimento_desde, now()), ultimo_movimento = now()
      FROM (
        SELECT DISTINCT ON (s2.id) s2.id, x.para
          FROM public.sugestoes s2
          JOIN public.erp_agente_mensagem x
            ON (x.sugestao_id = s2.id OR x.chamado_numero = s2.numero)
         WHERE x.status IN ('nova', 'recebida', 'em_andamento')
           AND coalesce(x.arquivada, false) = false
           AND x.para IN (SELECT p.agente FROM public.erp_agente_papel p WHERE p.papel = 'dev_hub')
           AND (s2.agente IS NULL OR s2.agente = '')
           AND s2.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
         ORDER BY s2.id, x.criado_em DESC
      ) t
     WHERE s.id = t.id
    RETURNING 1
  )
  SELECT v_sync + count(*) INTO v_sync FROM sync_b;

  -- Devolução: tarefa de chamado aberta há > 24 h em dev pausado/fora do papel ou sem atividade em 2 h volta ao grupo.
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

  -- Candidatos do roteador normal (dev_hub, sem dono de sócio): roteados por menor fila, até p_limite.
  FOR c IN
    SELECT s.id, s.numero, s.titulo, s.descricao, s.area, s.categoria, s.rota, s.prioridade,
           EXISTS (SELECT 1 FROM public.erp_chamado_regra_sensivel r
                    WHERE r.ativo
                      AND (s.titulo ILIKE '%' || r.padrao || '%' OR s.descricao ILIKE '%' || r.padrao || '%'
                           OR s.area ILIKE '%' || r.padrao || '%' OR s.categoria ILIKE '%' || r.padrao || '%')) AS sensivel
      FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
       AND coalesce(s.interno, false) = false
       AND s.numero IS NOT NULL
       AND public.fn_chamado_agente_dono(s.id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE (t.sugestao_id = s.id OR t.chamado_numero = s.numero)
                          AND t.status IN ('nova', 'recebida', 'em_andamento')
                          AND coalesce(t.arquivada, false) = false)
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE (t.sugestao_id = s.id OR t.chamado_numero = s.numero)
                          AND t.requer_ok_ceo AND t.ok_ceo_em IS NOT NULL)
       AND s.status <> 'aguardando_confirmacao'
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
    EXIT WHEN v_rot >= p_limite;
    IF c.sensivel THEN v_sens := v_sens + 1; END IF;
    v_dev := public.fn_dev_mais_vazio();
    IF v_dev IS NULL THEN EXIT; END IF;  -- cai para a rede de segurança abaixo
    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado aberto que ninguém trabalha (roteador, decisão do CEO 28/10).' || E'\n'
      || 'Chamado: #' || c.numero || ' (id ' || c.id || ')' || E'\n'
      || 'Rota: ' || coalesce(c.rota, '—') || E'\n'
      || 'Área: ' || coalesce(c.area, '—') || ' · Prioridade: ' || coalesce(c.prioridade::text, '—') || E'\n'
      || CASE WHEN c.sensivel
              THEN 'SENSÍVEL: qualquer PR deste chamado leva a label revisao-eng-chefe e NÃO publica sem aprovação do CEO/sócio.' || E'\n'
              ELSE '' END
      || '(LGPD: título e descrição do cliente NÃO são copiados para a fila; leia pelo id em sugestoes.)' || E'\n\n'
      || 'Regras: PR pequena, com "Code: ' || v_dev || '" no corpo. A resposta ao cliente só sai por '
      || 'fn_agente_chamado_responder, com OK do CEO. Não conclua esta tarefa antes de resolver o chamado.',
      c.sensivel, 'eng_chefe');
    v_msg := (v_res ->> 'id')::uuid;
    UPDATE public.erp_agente_mensagem SET sugestao_id = c.id, chamado_numero = c.numero, sensivel = c.sensivel WHERE id = v_msg;
    UPDATE public.sugestoes SET agente = v_dev, em_atendimento_desde = now(), ultimo_movimento = now() WHERE id = c.id;
    v_rot := v_rot + 1;
  END LOOP;

  -- (4) REDE DE SEGURANÇA: TODO chamado ativo sem tarefa ativa ganha uma, por MENOS CHEIO (fila única, sem
  --     carteira) — inclui sócio-escopo, hub_tela_dono e órfãos de agente. Garante a invariante 1:1 por rodada.
  FOR c IN
    SELECT s.id, s.numero, s.area, s.rota, s.prioridade,
           EXISTS (SELECT 1 FROM public.erp_chamado_regra_sensivel r
                    WHERE r.ativo
                      AND (s.titulo ILIKE '%' || r.padrao || '%' OR s.descricao ILIKE '%' || r.padrao || '%'
                           OR s.area ILIKE '%' || r.padrao || '%' OR s.categoria ILIKE '%' || r.padrao || '%')) AS sensivel
      FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento')
       AND coalesce(s.interno, false) = false
       AND s.numero IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE (t.sugestao_id = s.id OR t.chamado_numero = s.numero)
                          AND t.status IN ('nova', 'recebida', 'em_andamento')
                          AND coalesce(t.arquivada, false) = false)
     ORDER BY s.prioridade DESC NULLS LAST, s.created_at
  LOOP
    -- menos cheio entre os Codes da fila única (sempre retorna um; nunca NULL)
    SELECT q.a INTO v_dev FROM (
        SELECT p.agente AS a FROM public.erp_agente_papel p
         WHERE p.papel = 'dev_hub' AND p.agente NOT IN ('gilberto-desenv', 'desenvolvedor_5_g')
        UNION
        SELECT x.a FROM (VALUES ('jordana-code'), ('rodrigo-code')) AS x(a)
      ) q
     ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem am
                WHERE am.para = q.a AND am.status IN ('nova', 'recebida', 'em_andamento')
                  AND coalesce(am.arquivada, false) = false) ASC, q.a ASC
     LIMIT 1;
    IF v_dev IS NULL THEN v_sem := v_sem + 1; EXIT; END IF;
    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado ativo sem tarefa (rede de segurança do roteador, CEO 10/11 — fila única, sem carteira).' || E'\n'
      || 'Chamado: #' || c.numero || ' (id ' || c.id || ')' || E'\n'
      || 'Rota: ' || coalesce(c.rota, '—') || ' · Área: ' || coalesce(c.area, '—')
      || ' · Prioridade: ' || coalesce(c.prioridade::text, '—') || E'\n'
      || CASE WHEN c.sensivel
              THEN 'SENSÍVEL: qualquer PR deste chamado leva a label revisao-eng-chefe e NÃO publica sem aprovação do CEO/sócio.' || E'\n'
              ELSE '' END
      || '(LGPD: leia título/descrição pelo id em sugestoes; não são copiados para a fila.)' || E'\n\n'
      || 'Regras: PR pequena, com "Code: ' || v_dev || '" no corpo. A resposta ao cliente só sai por '
      || 'fn_agente_chamado_responder, com OK do CEO/sócio. Não conclua antes de resolver o chamado.',
      c.sensivel, 'eng_chefe');
    v_msg := (v_res ->> 'id')::uuid;
    UPDATE public.erp_agente_mensagem SET sugestao_id = c.id, chamado_numero = c.numero, sensivel = c.sensivel WHERE id = v_msg;
    UPDATE public.sugestoes SET agente = v_dev, em_atendimento_desde = coalesce(em_atendimento_desde, now()), ultimo_movimento = now() WHERE id = c.id;
    v_rede := v_rede + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteados', v_rot, 'sensiveis_roteados', v_sens, 'devolvidos', v_dev_n,
                            'sincronizados', v_sync, 'dedup', v_dedup, 'rede_seguranca', v_rede,
                            'sem_dev_vivo', v_sem, 'em', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_chamados_rotear(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_rotear(integer) TO service_role;

-- RETROATIVO: destrava os chamados ativos sem tarefa AGORA (idempotente; a rede de segurança varre todos).
SELECT public.fn_chamados_rotear(10);
