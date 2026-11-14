-- Roteamento de chamados: FILA ÚNICA por MENOR CARGA, só devs ATIVOS (CEO 14/11).
--
-- Contexto (mensagens eng_chefe 50b5152e + 84a1642b):
--   O CEO redefiniu a distribuição: fila única dinâmica por menor carga, SEM dev dono
--   de vertical. A fn_chamados_rotear já usava "menor fila", mas com o POOL ERRADO:
--   incluía desenvolvedor_5_g (emergência) e dependia da tabela erp_agente_papel, onde
--   desenvolvedor_6_g nem estava cadastrado como dev_hub. Além disso, não filtrava por
--   dev ATIVO: mandava tarefa para dev pausado, que encalhava e nunca era feita.
--
-- Entrega:
--   1) fn_devs_pool(): pool canônico e EXATO dos 6 produtores
--      (dev7claudeps, code-desenvolvedor-3, desenvolvedor_4_g, desenvolvedor_6_g,
--       rodrigo-code, jordana-code). Remove desenvolvedor_5_g (emergência) e passa a
--      não depender mais da membership de erp_agente_papel.
--   2) fn_dev_ativo(agente, horas=2): dev está ativo se teve execução
--      (erp_code_execucao_log) OU lease renovada (erp_agente_sessao_lease) na janela.
--      Janela fixada pelo CEO 14/11 em 2 HORAS; recalculada a cada chamada (sem lista fixa).
--   3) fn_dev_mais_vazio(): escolhe, ENTRE OS ATIVOS do pool, o de menor carga
--      (tarefas abertas na caixa). Empate -> aleatório. NULL se NENHUM ativo.
--   4) fn_chamados_rotear(): usa o pool/ativo acima; se nenhum dev ativo, a tarefa fica
--      em ESPERA GERAL (não atribuída) e avisa o Eng. Chefe uma vez; tarefa presa > 6 h
--      num dev INATIVO volta à fila para re-roteamento a um dev ativo.
--   5) v_devs_carga: dev, tarefas abertas e se está ativo — para o Eng. Chefe/painel.
--
-- Aditiva/idempotente (CREATE OR REPLACE). Não altera dado de cliente. RD-38: a prova
-- de leitura está no corpo do PR (pool = 6 devs, 5_g fora, dev4_g/code-3 ativos hoje).

-- (1) Pool canônico dos devs produtores (fila única, sem dono de vertical).
CREATE OR REPLACE FUNCTION public.fn_devs_pool()
 RETURNS TABLE(agente text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT a FROM (VALUES
    ('dev7claudeps'),
    ('code-desenvolvedor-3'),
    ('desenvolvedor_4_g'),
    ('desenvolvedor_6_g'),
    ('rodrigo-code'),
    ('jordana-code')
  ) AS x(a);
$function$;

REVOKE ALL ON FUNCTION public.fn_devs_pool() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_devs_pool() TO authenticated, service_role;

-- (2) Dev ativo = execução recente OU lease renovada na janela (parametrizável, padrão 2 h — CEO 14/11).
CREATE OR REPLACE FUNCTION public.fn_dev_ativo(p_agente text, p_horas integer DEFAULT 2)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.erp_code_execucao_log l
                  WHERE l.agente = p_agente
                    AND l.iniciada_em > now() - make_interval(hours => p_horas))
      OR EXISTS (SELECT 1 FROM public.erp_agente_sessao_lease s
                  WHERE s.agente = p_agente
                    AND s.renovada_em > now() - make_interval(hours => p_horas)
                    AND s.renovada_em >= s.iniciada_em);
$function$;

REVOKE ALL ON FUNCTION public.fn_dev_ativo(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_ativo(text, integer) TO authenticated, service_role;

-- (3) Dev de menor carga ENTRE OS ATIVOS do pool. NULL quando nenhum ativo.
CREATE OR REPLACE FUNCTION public.fn_dev_mais_vazio()
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT q.agente
    FROM public.fn_devs_pool() q
   WHERE public.fn_dev_ativo(q.agente, 2)  -- janela de atividade: 2 h (CEO 14/11)
   ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = q.agente
                AND m.status IN ('nova', 'recebida', 'em_andamento')
                AND coalesce(m.arquivada, false) = false) ASC,
            random()
   LIMIT 1;
$function$;

-- (5) Carga por dev para o Eng. Chefe / painel (balanceamento da fila única).
CREATE OR REPLACE VIEW public.v_devs_carga AS
  SELECT d.agente,
         (SELECT count(*) FROM public.erp_agente_mensagem m
           WHERE m.para = d.agente
             AND m.status IN ('nova', 'recebida', 'em_andamento')
             AND coalesce(m.arquivada, false) = false) AS tarefas_abertas,
         public.fn_dev_ativo(d.agente, 2) AS ativo
    FROM public.fn_devs_pool() d
   ORDER BY public.fn_dev_ativo(d.agente, 2) DESC,
            (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = d.agente
                AND m.status IN ('nova', 'recebida', 'em_andamento')
                AND coalesce(m.arquivada, false) = false) ASC,
            d.agente;

REVOKE ALL ON TABLE public.v_devs_carga FROM anon;
GRANT SELECT ON TABLE public.v_devs_carga TO authenticated, service_role;

-- (4) Roteador: fila única por menor carga, só ativos; espera geral + aviso se ninguém ativo.
CREATE OR REPLACE FUNCTION public.fn_chamados_rotear(p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_janela_ativo constant integer := 2;  -- janela de atividade do dev em HORAS (CEO 14/11). Ajuste aqui.
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

  -- Devolução (CEO 14/11): tarefa de chamado presa > 6 h num dev INATIVO (pausado/dormiu)
  -- volta ao grupo para ser re-roteada a um dev ativo. Chamado de sócio (com dono de escopo)
  -- NUNCA é devolvido à fila geral — continua do dono.
  FOR m IN
    SELECT x.id, x.sugestao_id
      FROM public.erp_agente_mensagem x
     WHERE x.sugestao_id IS NOT NULL
       AND x.status IN ('nova', 'recebida', 'em_andamento')
       AND coalesce(x.arquivada, false) = false
       AND x.criado_em < now() - interval '6 hours'
       AND greatest(x.recebida_em, x.iniciada_em, x.atualizado_em, x.criado_em) < now() - interval '6 hours'
       AND public.fn_chamado_agente_dono(x.sugestao_id) IS NULL
       AND NOT public.fn_dev_ativo(x.para, v_janela_ativo)
  LOOP
    PERFORM public.fn_agente_mensagem_arquivar(m.id);
    IF m.sugestao_id IS NOT NULL THEN
      UPDATE public.sugestoes SET agente = NULL, em_atendimento_desde = NULL WHERE id = m.sugestao_id;
    END IF;
    v_dev_n := v_dev_n + 1;
  END LOOP;

  -- Candidatos do roteador normal (sem dono de sócio): roteados por menor fila ENTRE OS ATIVOS, até p_limite.
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
    v_dev := public.fn_dev_mais_vazio();
    IF v_dev IS NULL THEN EXIT; END IF;  -- nenhum dev ativo: cai para a rede de segurança (conta em espera)
    IF c.sensivel THEN v_sens := v_sens + 1; END IF;
    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado aberto que ninguém trabalha (roteador — fila única por menor carga, CEO 14/11).' || E'\n'
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

  -- (4) REDE DE SEGURANÇA: TODO chamado ativo sem tarefa ativa ganha uma. Respeita o DONO de
  --     escopo de sócio e o AGENTE já marcado SE estiver ATIVO; só então cai para a fila única
  --     (menor carga entre os ativos). Se NENHUM dev ativo, a tarefa fica em ESPERA GERAL (conta v_sem).
  FOR c IN
    SELECT s.id, s.numero, s.area, s.rota, s.prioridade, s.agente,
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
    -- (1) dono de escopo de sócio tem prioridade (chamado do sócio vai para o Code do sócio)
    v_dev := public.fn_chamado_agente_dono(c.id);
    -- (2) senão, o agente já marcado SE estiver ATIVO
    IF v_dev IS NULL AND c.agente IS NOT NULL AND c.agente <> '' AND public.fn_dev_ativo(c.agente, v_janela_ativo) THEN
      v_dev := c.agente;
    END IF;
    -- (3) senão, menor carga da fila única ENTRE OS ATIVOS (NULL se nenhum ativo)
    IF v_dev IS NULL THEN
      v_dev := public.fn_dev_mais_vazio();
    END IF;
    IF v_dev IS NULL THEN
      v_sem := v_sem + 1;  -- sem dev ativo: fica em espera geral, o primeiro que acordar puxa
      CONTINUE;
    END IF;
    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado ativo sem tarefa (rede de segurança do roteador — fila única por menor carga, só devs ativos, CEO 14/11).' || E'\n'
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

  -- Aviso ao Eng. Chefe: nenhum dev ativo e N tarefas em espera (uma mensagem aberta por vez).
  IF v_sem > 0 AND NOT EXISTS (
       SELECT 1 FROM public.erp_agente_mensagem x
        WHERE x.para = 'eng_chefe' AND x.tipo = 'aviso'
          AND x.assunto LIKE 'ROTEADOR: sem dev ativo%'
          AND x.status IN ('nova', 'recebida', 'em_andamento')
          AND coalesce(x.arquivada, false) = false) THEN
    PERFORM public.fn_agente_mensagem_enviar(
      'eng_chefe', 'eng_chefe', 'aviso',
      'ROTEADOR: sem dev ativo — ' || v_sem || ' tarefa(s) em espera',
      'A fila única não encontrou nenhum dev ATIVO (execução/lease nas últimas 4 h) para '
      || v_sem || ' chamado(s) ativo(s). Eles ficam em ESPERA GERAL (não atribuídos) e o primeiro '
      || 'dev que voltar a ficar ativo puxa no próximo ciclo do roteador.' || E'\n'
      || 'Pool: dev7claudeps, code-desenvolvedor-3, desenvolvedor_4_g, desenvolvedor_6_g, rodrigo-code, jordana-code.',
      false, 'eng_chefe');
  END IF;

  RETURN jsonb_build_object('ok', true, 'roteados', v_rot, 'sensiveis_roteados', v_sens, 'devolvidos', v_dev_n,
                            'sincronizados', v_sync, 'dedup', v_dedup, 'rede_seguranca', v_rede,
                            'sem_dev_vivo', v_sem, 'em', now());
END;
$function$;
