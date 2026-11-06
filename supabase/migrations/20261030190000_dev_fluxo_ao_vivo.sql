-- Central de Desenvolvimento › aba "Fluxo ao vivo" (CEO 29/10/2026 06:20 e 06:27).
-- Fluxograma vivo de toda a infra: Comando → Construção → Revisão → Publicação → Produção → Conferência (PDCA) → volta.
--
-- Regra do CEO (06:27): a lista de Codes é DINÂMICA e reflete o banco. Nenhum Code é fixo no código:
--   * aparece todo Code com sessão (erp_agente_sessao_lease) dentro da janela (padrão 120 min) — Code novo ou
--     reativado entra sozinho na primeira sessão;
--   * Code pausado/desligado deixa de abrir sessão e SOME da tela quando a última sessão sai da janela;
--   * erp_agente_papel.pausado só marca "fora do roteamento" (não tira da tela um Code que segue trabalhando).
-- Os robôs (cron) também são dinâmicos: só entram os jobs ATIVOS da lista de cada etapa; job desligado some.
--
-- Aditiva: 1 função nova (só leitura) + "?" (RD-95) + system_screens (RD-50). Nenhuma função existente recriada.

CREATE OR REPLACE FUNCTION public.fn_infra_fluxo_vivo(p_janela_min integer DEFAULT 120)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_jan int := LEAST(GREATEST(COALESCE(p_janela_min, 120), 30), 1440);
  v_codes jsonb; v_crons jsonb; v_esteira jsonb; v_cham jsonb; v_rev jsonb; v_doc jsonb; v_caixa jsonb;
  v_ult_pub timestamptz; v_gargalo jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão' USING errcode = '42501'; END IF;

  -- 1) Codes vivos: quem deu sinal de vida na janela. Nada fixo — o banco decide quem aparece.
  --    Sinal de vida = ato do PRÓPRIO Code: sessão (lease), leitura/início/conclusão de mensagem da caixa, PR aberta/pronta.
  --    (Publicação é ato da fila, não do Code — não conta, para Code pausado não "voltar" quando a fila publica a PR dele.)
  WITH atv AS (
    SELECT l.agente, greatest(l.iniciada_em, l.renovada_em) AS t, (l.renovada_em > now() - interval '12 minutes') AS trab
      FROM erp_agente_sessao_lease l
    UNION ALL
    SELECT m.para, greatest(m.recebida_em, m.iniciada_em, m.concluida_em), false
      FROM erp_agente_mensagem m
     WHERE greatest(m.recebida_em, m.iniciada_em, m.concluida_em) > now() - interval '1 day'
    UNION ALL
    SELECT x.code, x.ocorrido_em, false
      FROM erp_dev_entrega x
     WHERE x.evento IN ('aberta', 'pronta') AND x.ocorrido_em > now() - interval '1 day' AND x.code IS NOT NULL
  ), ses AS (
    SELECT a.agente, max(a.t) AS ultima, bool_or(a.trab) AS trabalhando
      FROM atv a
     WHERE a.agente IS NOT NULL AND a.agente NOT IN ('eng_chefe', 'eng-chefe', 'ceo', 'sessao-manual')
     GROUP BY a.agente
  ), vivos AS (
    SELECT * FROM ses WHERE ultima > now() - make_interval(mins => v_jan)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', v.agente,
           'etapa', CASE WHEN v.agente ~* '(^aud|auditor)' THEN 'conferencia'
                         WHEN v.agente ~* 'revisor' THEN 'revisao'
                         WHEN v.agente ~* 'esteira' THEN 'publicacao'
                         ELSE 'construcao' END,
           'trabalhando', COALESCE(v.trabalhando, false),
           'ultima_sessao', v.ultima,
           'tarefas_abertas', t.n,
           'tarefa_mais_antiga_h', t.antiga_h,
           'publicadas_24h', e.pub,
           'prs_abertas', e.abertas,
           'fora_do_roteamento', COALESCE(p.pausado, false),
           'estado', CASE WHEN COALESCE(v.trabalhando, false) THEN 'trabalhando'
                          WHEN t.n > 20 THEN 'acumulando'
                          ELSE 'ok' END
         ) ORDER BY CASE WHEN v.agente ~* '(^aud|auditor)' THEN 4 WHEN v.agente ~* 'revisor' THEN 2
                         WHEN v.agente ~* 'esteira' THEN 3 ELSE 1 END, v.agente), '[]'::jsonb)
    INTO v_codes
    FROM vivos v
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n,
             round((EXTRACT(EPOCH FROM now() - min(m.criado_em)) / 3600)::numeric, 0) AS antiga_h
        FROM erp_agente_mensagem m
       WHERE m.para = v.agente AND m.tipo = 'tarefa' AND NOT COALESCE(m.arquivada, false)
         AND m.status IN ('nova', 'recebida', 'em_andamento')
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT x.pr_numero) FILTER (WHERE x.evento = 'publicada' AND x.ocorrido_em > now() - interval '24 hours')::int AS pub,
             (SELECT count(*)::int FROM (
                SELECT DISTINCT ON (y.pr_numero) y.evento FROM erp_dev_entrega y
                 WHERE y.code = v.agente AND y.ocorrido_em > now() - interval '14 days'
                 ORDER BY y.pr_numero, y.ocorrido_em DESC) z
               WHERE z.evento IN ('aberta', 'pronta')) AS abertas
        FROM erp_dev_entrega x
       WHERE x.code = v.agente AND x.ocorrido_em > now() - interval '24 hours'
    ) e ON true
    LEFT JOIN LATERAL (SELECT bool_or(pp.pausado) AS pausado FROM erp_agente_papel pp WHERE pp.agente = v.agente) p ON true;

  -- 2) Robôs (cron) por etapa — só os jobs ATIVOS entram; desligou, some.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', j.jobname, 'etapa', c.etapa, 'rotulo', c.rotulo, 'agenda', j.schedule,
           'ultima', (SELECT max(d.start_time) FROM cron.job_run_details d
                       WHERE d.jobid = j.jobid AND d.start_time > now() - interval '2 days'),
           'ultimo_ok', (SELECT d.status = 'succeeded' FROM cron.job_run_details d
                          WHERE d.jobid = j.jobid AND d.start_time > now() - interval '2 days'
                          ORDER BY d.start_time DESC LIMIT 1)
         ) ORDER BY c.ordem), '[]'::jsonb)
    INTO v_crons
    FROM cron.job j
    JOIN (VALUES
      ('agente_despertador',          'comando',     'Despertador dos Codes', 1),
      ('chamados-rotear-hora',        'construcao',  'Roteador de chamados', 2),
      ('chamados-trava-expirar-hora', 'construcao',  'Libera chamado travado', 3),
      ('revisor-pendencias-5min',     'revisao',     'Acorda o revisor', 4),
      ('esteira-vigia-5min',          'publicacao',  'Vigia da esteira', 5),
      ('monitor-merge-tick',          'publicacao',  'Monitor da main', 6),
      ('vigia-coleta-agentes',        'producao',    'Vigia de runs', 7),
      ('dev-main-vermelha-alerta',    'producao',    'Alerta main vermelha', 8),
      ('pdca-hub-tick-hora',          'conferencia', 'PDCA do Hub', 9),
      ('playwright-dias-impares-05h', 'conferencia', 'Fotos automáticas', 10),
      ('auditor-pos-merge-5min',      'conferencia', 'Auditor pós-publicação', 11),
      ('truth-auditor-dre-1h',        'conferencia', 'Auditor da verdade (DRE)', 12),
      ('rd35-detectar-drift-15min',   'conferencia', 'Auditor de drift', 13)
    ) AS c(nome, etapa, rotulo, ordem) ON c.nome = j.jobname
   WHERE j.active;

  -- 3) Esteira (mesma fonte da aba Codes) e última publicação.
  v_esteira := public.fn_esteira_saude();
  SELECT max(ocorrido_em) INTO v_ult_pub FROM erp_dev_entrega WHERE evento = 'publicada';

  -- 4) Revisão: PRs da via revisada fora da rodada (esperando autorização/ajuste).
  SELECT jsonb_build_object(
           'revisadas_paradas', count(*) FILTER (WHERE via = 'revisada' AND estado = 'fora-da-rodada'),
           'esperando', count(*) FILTER (WHERE estado = 'esperando'),
           'atualizado_em', max(atualizado_em))
    INTO v_rev FROM erp_esteira_pr_estado;

  -- 5) Chamados por Code responsável.
  SELECT jsonb_build_object(
           'abertos', count(*), 'esperando_ps', count(*) FILTER (WHERE esperando_ps),
           'por_code', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code_responsavel, 'abertos', n) ORDER BY n DESC)
                                   FROM (SELECT code_responsavel, count(*) AS n FROM v_chamado_code_responsavel GROUP BY 1) q), '[]'::jsonb))
    INTO v_cham FROM v_chamado_code_responsavel;

  -- 6) Caixa de mensagens (comando).
  SELECT jsonb_build_object(
           'tarefas_abertas', count(*) FILTER (WHERE tipo = 'tarefa' AND status IN ('nova', 'recebida', 'em_andamento') AND NOT COALESCE(arquivada, false)),
           'enviadas_24h', count(*) FILTER (WHERE de = 'eng_chefe' AND criado_em > now() - interval '24 hours'),
           'ultima_ordem', max(criado_em) FILTER (WHERE de IN ('eng_chefe', 'ceo')))
    INTO v_caixa FROM erp_agente_mensagem WHERE criado_em > now() - interval '60 days';

  -- 7) Decisões vigentes (Documento Mestre de Infraestrutura).
  SELECT jsonb_build_object('versao', versao, 'resumo', resumo_mudanca, 'criado_em', criado_em)
    INTO v_doc FROM erp_documento_vertical WHERE vertical = 'infraestrutura' AND vigente ORDER BY versao DESC LIMIT 1;

  -- 8) Gargalo (onde o fluxo trava agora), em ordem de gravidade.
  v_gargalo := CASE
    WHEN (v_esteira->>'portao_verde')::boolean IS FALSE THEN
      jsonb_build_object('etapa', 'producao', 'texto', 'Teste da main vermelho: as publicações com migration esperam a correção.')
    WHEN v_ult_pub < now() - interval '3 hours' AND COALESCE((v_rev->>'revisadas_paradas')::int, 0) > 0 THEN
      jsonb_build_object('etapa', 'revisao', 'texto', format('Nada publicado há %s h e %s PR(s) da via revisada esperando autorização ou ajuste.',
        round((EXTRACT(EPOCH FROM now() - v_ult_pub) / 3600)::numeric, 0), v_rev->>'revisadas_paradas'))
    WHEN v_ult_pub < now() - interval '3 hours' THEN
      jsonb_build_object('etapa', 'construcao', 'texto', format('Nada publicado há %s h: nenhuma PR pronta chegou à fila.',
        round((EXTRACT(EPOCH FROM now() - v_ult_pub) / 3600)::numeric, 0)))
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_codes) c WHERE (c->>'tarefas_abertas')::int > 50) THEN
      jsonb_build_object('etapa', 'construcao', 'texto', 'Há Code com mais de 50 tarefas abertas na caixa: a fila cresce mais rápido do que ele entrega.')
    ELSE NULL END;

  RETURN jsonb_build_object(
    'gerado_em', now(), 'janela_min', v_jan,
    'codes', v_codes, 'robos', v_crons, 'esteira', v_esteira, 'ultima_publicacao', v_ult_pub,
    'revisao', v_rev, 'chamados', v_cham, 'caixa', v_caixa, 'decisoes', v_doc, 'gargalo', v_gargalo);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_infra_fluxo_vivo(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_fluxo_vivo(integer) TO authenticated;

-- "?" (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Fluxo ao vivo', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/fluxo', 'dev', 'publicado'
FROM (VALUES
 ('dev.fluxo.tela', 'Fluxo ao vivo', 'Nada a preencher: é a fotografia da fábrica de software agora.',
  'Mostra cada etapa (comando, construção, revisão, publicação, produção e conferência) com o estado real tirado do banco e da esteira, atualizado a cada 30 s.',
  'Etapa com borda vermelha = é ali que o fluxo está travando agora.', 'Achar que a tela é desenho fixo: tudo vem do banco.', 1),
 ('dev.fluxo.gargalo', 'Gargalo agora', 'Indicador calculado.',
  'Aponta em uma frase onde o fluxo está parado: teste da main vermelho, PRs esperando o revisor ou Codes com fila grande.',
  '"Nada publicado há 7 h e 7 PRs esperando autorização" → gargalo na Revisão.', 'Ignorar: o gargalo define o que destravar primeiro.', 2),
 ('dev.fluxo.codes', 'Codes na tela', 'Nada a preencher: a lista se monta sozinha.',
  'Aparece todo Code que abriu sessão na janela (padrão 2 h). Code novo ou reativado entra sozinho; Code pausado ou desligado some quando a última sessão sai da janela.',
  'Pausou o desenvolvedor_4_g às 10:00 → some da tela até 12:00. Religou → volta na primeira sessão.', 'Procurar Code pausado aqui: ele só reaparece quando voltar a rodar.', 3),
 ('dev.fluxo.janela', 'Janela de atividade', 'Escolha quanto tempo para trás conta como "ativo".',
  'Define quem aparece: Code com sessão dentro da janela. Janela curta mostra só quem está rodando agora.',
  '2 h (padrão) para rotinas de hora em hora.', 'Janela de 30 min esconde Code que roda de hora em hora.', 4),
 ('dev.fluxo.robos', 'Robôs (agendamentos)', 'Nada a preencher.',
  'Agendamentos do banco que movem cada etapa (despertador, roteador de chamados, PDCA, fotos, vigias). Só aparecem os ligados.',
  'PDCA do Hub · de hora em hora · última 06:00.', 'Robô que não aparece está desligado.', 5),
 ('dev.fluxo.estado', 'Cor do estado', 'Indicador calculado.',
  'Verde: rodando/na cadência. Amarelo: acumulando (mais de 20 tarefas) ou sem rodar há um tempo. Vermelho: travando o fluxo. Cinza: fora do roteamento automático.',
  'dev7 com 88 tarefas → amarelo.', 'Confundir amarelo (fila grande) com erro.', 6),
 ('dev.fluxo.ritmo', 'Ritmo das últimas 24 h', 'Indicador calculado.',
  'Publicações em 24 h, intervalo mediano entre publicações e tempo de main vermelha — os mesmos números da aba Codes.',
  '38 publicadas · 23 min entre publicações.', 'Comparar com o dia todo: a janela é sempre as últimas 24 h.', 7),
 ('dev.fluxo.decisoes', 'Decisões vigentes', 'Nada a preencher.',
  'Versão do Documento Mestre de Infraestrutura que todas as Claudes e Codes leem ao abrir a sessão, com o resumo da última mudança.',
  'V62 (29/10): regra da PROVA, revisor em uma passada.', 'Decidir algo só no chat: decisão de infra vale quando entra no documento.', 8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- system_screens (RD-50): rota própria da aba, como /dashboard/dev/codes.
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('dev_fluxo', '/dashboard/dev/fluxo', 'dev', 'dev_fluxo', 'Fluxo ao vivo',
  'Fluxograma vivo da infra: comando → construção → revisão → publicação → produção → conferência (PDCA), com Codes e robôs dinâmicos (aparecem/somem conforme o banco), gargalo do momento e decisões vigentes.',
  'parcial', 'media', ARRAY['fn_infra_fluxo_vivo','fn_codes_qualidade_vertical']::text[], ARRAY['FluxoVivo']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
