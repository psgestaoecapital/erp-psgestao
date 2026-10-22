-- Painel de Codes (CEO 16/10 19:15): aba "Infraestrutura" — funções NOVAS, só leitura, agregadas e guardadas por
-- fn_dev_painel_pode_ver (equipe PS ativa). cron.job, gold_veredito_triplo e sugestoes não são legíveis pelo navegador.
-- Aditiva (RD-97): nada existente é alterado. Plano de volta: DROP FUNCTION public.fn_dev_infra_desempenho(); DROP FUNCTION public.fn_dev_infra_agentes();
-- e DELETE FROM erp_ajuda_campo WHERE chave LIKE 'dev.infra.%' (só texto de ajuda novo).
CREATE OR REPLACE FUNCTION public.fn_dev_infra_desempenho() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_hoje timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_ini timestamptz;
  v_chave text;
  v_horas numeric;
  v_res jsonb := '{}'::jsonb;
  v_bloco jsonb;
  v_main record;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  FOREACH v_chave IN ARRAY ARRAY['hoje', 'd7'] LOOP
    v_ini := CASE v_chave WHEN 'hoje' THEN v_hoje ELSE now() - interval '7 days' END;
    v_horas := GREATEST(EXTRACT(EPOCH FROM (now() - v_ini)) / 3600.0, 1);
    SELECT jsonb_build_object(
      -- PEDIDO: chamados de clientes (sem interno do auditor, sem robô/teste)
      'chamados_novos', (SELECT count(*) FROM sugestoes s WHERE s.created_at >= v_ini AND COALESCE(s.interno, false) = false
                          AND COALESCE(s.user_email, '') !~* 'robo|aceit|vigia|demo|e2e'),
      'resp_20min_pct', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE m.primeiro IS NOT NULL AND m.primeiro <= m.created_at + interval '20 minutes') / count(*), 1) END
                          FROM (SELECT s.created_at, LEAST(s.em_atendimento_desde, s.resposta_aprovada_em,
                                  (SELECT min(h.criado_em) FROM sugestao_atendimento_hist h WHERE h.sugestao_id = s.id AND h.acao = 'assumir')) AS primeiro
                                  FROM sugestoes s WHERE s.created_at >= v_ini AND COALESCE(s.interno, false) = false
                                  AND COALESCE(s.user_email, '') !~* 'robo|aceit|vigia|demo|e2e') m),
      -- CODE CONSTRÓI + ESTEIRA + PUBLICAÇÃO (erp_dev_entrega)
      'prs_produzidas', (SELECT count(DISTINCT pr_numero) FROM erp_dev_entrega WHERE evento = 'aberta' AND ocorrido_em >= v_ini),
      'prs_publicadas', (SELECT count(DISTINCT pr_numero) FROM erp_dev_entrega WHERE evento = 'publicada' AND ocorrido_em >= v_ini),
      'publicadas_por_hora', (SELECT round(count(DISTINCT pr_numero) / v_horas, 2) FROM erp_dev_entrega WHERE evento = 'publicada' AND ocorrido_em >= v_ini),
      'aberta_pronta_min', (SELECT round(avg(EXTRACT(EPOCH FROM (p.pronta - p.aberta)) / 60.0)::numeric, 1) FROM (
                              SELECT pr_numero, min(ocorrido_em) FILTER (WHERE evento = 'aberta') AS aberta, min(ocorrido_em) FILTER (WHERE evento = 'pronta') AS pronta
                              FROM erp_dev_entrega WHERE ocorrido_em >= v_ini - interval '14 days' GROUP BY 1) p
                            WHERE p.pronta >= v_ini AND p.aberta IS NOT NULL AND p.pronta >= p.aberta),
      'pronta_publicada_min', (SELECT round(avg(EXTRACT(EPOCH FROM (p.pub - p.pronta)) / 60.0)::numeric, 1) FROM (
                              SELECT pr_numero, min(ocorrido_em) FILTER (WHERE evento = 'pronta') AS pronta, max(ocorrido_em) FILTER (WHERE evento = 'publicada') AS pub
                              FROM erp_dev_entrega WHERE ocorrido_em >= v_ini - interval '14 days' GROUP BY 1) p
                            WHERE p.pub >= v_ini AND p.pronta IS NOT NULL AND p.pub >= p.pronta),
      'por_code', COALESCE((SELECT jsonb_object_agg(c, n) FROM (
                    SELECT COALESCE(NULLIF(code, ''), 'não identificado') AS c, count(DISTINCT pr_numero) AS n
                    FROM erp_dev_entrega WHERE evento = 'aberta' AND ocorrido_em >= v_ini GROUP BY 1) q), '{}'::jsonb),
      -- CODE-AUDITOR
      'auditor_telas', (SELECT count(DISTINCT screen_id) FROM (
                          SELECT screen_id FROM gold_veredito_triplo WHERE executado_em >= v_ini
                          UNION SELECT screen_id FROM system_screens_insights WHERE analisado_em >= v_ini) x),
      'auditor_vereditos', COALESCE((SELECT jsonb_object_agg(v, n) FROM (
                          SELECT COALESCE(veredito_final, 'PENDENTE') AS v, count(*) AS n FROM gold_veredito_triplo
                          WHERE executado_em >= v_ini GROUP BY 1) y), '{}'::jsonb),
      'auditor_nota_hub', (SELECT round(avg(score_evolucao_pct)::numeric, 1) FROM system_screens_insights
                           WHERE analisado_em >= v_ini AND blueprint_vertical = 'hub_projetos'),
      -- VOLTA: achados internos do auditor (empresa DEMO, agente gilberto-produto)
      'achados_abertos', (SELECT count(*) FROM sugestoes WHERE COALESCE(interno, false) AND agente = 'gilberto-produto'
                           AND status IN ('nova', 'em_analise', 'aguardando_confirmacao') AND created_at >= v_ini),
      'achados_fechados', (SELECT count(*) FROM sugestoes WHERE COALESCE(interno, false) AND agente = 'gilberto-produto'
                           AND status = 'concluida' AND concluido_em >= v_ini),
      'achado_correcao_min', (SELECT round(avg(EXTRACT(EPOCH FROM (concluido_em - created_at)) / 60.0)::numeric, 1) FROM sugestoes
                           WHERE COALESCE(interno, false) AND agente = 'gilberto-produto' AND status = 'concluida' AND concluido_em >= v_ini)
    ) INTO v_bloco;
    v_res := v_res || jsonb_build_object(v_chave, v_bloco);
  END LOOP;
  -- Fotografia de agora (não depende da janela)
  SELECT verde, desde INTO v_main FROM erp_dev_main_teste WHERE id = 1;
  v_res := v_res || jsonb_build_object(
    'ok', true,
    'chamados_abertos', (SELECT count(*) FROM sugestoes WHERE status IN ('nova', 'em_analise') AND COALESCE(interno, false) = false
                          AND COALESCE(user_email, '') !~* 'robo|aceit|vigia|demo|e2e'),
    'chamados_idade_media_h', (SELECT round((avg(EXTRACT(EPOCH FROM (now() - created_at))) / 3600.0)::numeric), 1) FROM sugestoes
                          WHERE status IN ('nova', 'em_analise') AND COALESCE(interno, false) = false
                          AND COALESCE(user_email, '') !~* 'robo|aceit|vigia|demo|e2e'),
    'esteira_estados', COALESCE((SELECT jsonb_object_agg(e, n) FROM (SELECT estado AS e, count(*) AS n FROM erp_esteira_pr_estado GROUP BY 1) z), '{}'::jsonb),
    'esteira_sensiveis_esperando', (SELECT count(*) FROM erp_esteira_pr_estado WHERE via = 'revisada' AND estado = 'esperando'),
    'esteira_migrations_na_fila', (SELECT count(*) FROM erp_esteira_pr_estado WHERE COALESCE(tem_migration, false) AND estado <> 'fora-da-rodada'),
    'main_vermelha_min', CASE WHEN v_main.verde IS FALSE THEN round((EXTRACT(EPOCH FROM (now() - GREATEST(v_main.desde, v_hoje))) / 60.0)::numeric) ELSE 0 END,
    'gerado_em', now()
  );
  RETURN v_res;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_dev_infra_desempenho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_infra_desempenho() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_dev_infra_desempenho() IS
  'Aba Infraestrutura do Painel de Codes: números por etapa (pedido, construção, esteira, publicação, auditor, volta), hoje e 7 dias. Só equipe PS.';

CREATE OR REPLACE FUNCTION public.fn_dev_infra_agentes() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- agente → job de acordar no pg_cron (null = acordado por evento do GitHub, ver observação)
  SELECT jsonb_build_object('ok', true, 'agentes', COALESCE(jsonb_agg(jsonb_build_object(
      'agente', r.agente, 'aciona', r.aciona, 'observacao', r.observacao,
      'cron_job', m.job, 'cron_agenda', j.schedule, 'cron_ativo', j.active,
      'iniciada_em', l.iniciada_em, 'renovada_em', l.renovada_em) ORDER BY r.agente), '[]'::jsonb))
  INTO v_res
  FROM public.erp_agente_rotina r
  LEFT JOIN (VALUES
      ('gilberto-chamados', 'chamados-plantao-5min'), ('jordana-code', 'jordana-chamados-5min'),
      ('rodrigo-code', 'rodrigo-chamados-5min'), ('gilberto-produto', 'produto-hub-plantao'),
      ('gilberto-esteira', 'esteira-dono-5min'), ('eng-chefe-auto', 'auditor-pos-merge-5min'),
      ('gilberto-desenv', 'agente_despertador')) m(agente, job) ON m.agente = r.agente
  LEFT JOIN cron.job j ON j.jobname = m.job
  LEFT JOIN public.erp_agente_sessao_lease l ON l.agente = r.agente
  WHERE r.agente IN ('gilberto-produto', 'gilberto-esteira', 'gilberto-chamados', 'jordana-code', 'rodrigo-code',
                     'gilberto-desenv', 'gilberto-revisor', 'eng-chefe-auto');
  RETURN v_res;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_dev_infra_agentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_infra_agentes() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_dev_infra_agentes() IS
  'Aba Infraestrutura do Painel de Codes: papel, agenda do cron e última sessão de cada agente. Só equipe PS.';

-- "?" (RD-95) da aba Infraestrutura. Aditiva: só texto de ajuda novo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, row_number() OVER (ORDER BY v.chave) + 100, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.infra.aba', 'Aba Infraestrutura', 'Mostra como o pedido do cliente vira publicação e volta como achado; nada a preencher.', 'Dá a visão única da esteira: fluxograma, função de cada agente e desempenho por etapa.', 'Se o chamado está parado há horas, o gargalo aparece na etapa em vermelho.', 'Ler o número de "7 dias" achando que é de hoje: confira o botão de período.'),
 ('dev.infra.janela', 'Período', 'Escolha Hoje (desde 00:00 de São Paulo) ou 7 dias (últimas 168 horas).', 'Muda a janela dos números de cada etapa; os valores "de agora" (chamados abertos, fila, main) não mudam.', 'Hoje, para ver o ritmo do dia; 7 dias, para ver a tendência.', 'Comparar publicadas por hora de hoje cedo (poucas horas) com a média de 7 dias.'),
 ('dev.infra.fluxograma', 'Fluxograma', 'Toque numa caixa para abrir o detalhe daquela etapa; nada a preencher.', 'Mostra o caminho: pedido, construção, esteira, publicação, auditor e a volta como chamado interno. O ponto colorido é o pior semáforo da etapa.', 'Etapa Esteira em vermelho: há PRs sensíveis esperando o revisor.', 'Achar que a cor é da PR: é da etapa inteira.'),
 ('dev.infra.agentes', 'Funções de cada agente', 'Nada a preencher; é a lista dos agentes com papel, agenda e última sessão.', 'Mostra quem faz o quê, de quanto em quanto tempo é acordado e se está trabalhando, esperando ou dormindo.', 'gilberto-esteira: dono da esteira, acordado a cada 5 min.', 'Ler "dormindo" como defeito: agente desligado de propósito também aparece assim.'),
 ('dev.infra.leis', 'Leis', 'Nada a preencher; são as regras que valem para todos os agentes.', 'Lembra o que nenhum Code pode quebrar: RD-97, quem constrói não se auto-vigia, delegação e cofre só do CEO.', 'PR que mexe em banco sem plano de volta é revertida (RD-97).', 'Achar que delegação vale para núcleo: núcleo só com OK do CEO.'),
 ('dev.infra.desempenho', 'Desempenho por etapa', 'Nada a preencher; os números são calculados do banco a cada minuto.', 'Cada número tem semáforo (verde, amarelo, vermelho) com limites visíveis no "?" do número e na legenda.', 'Publicadas por hora abaixo de 2: amarelo/vermelho, a esteira está lenta.', 'Tratar semáforo como meta final: os limites podem ser revistos pelo CEO.'),
 ('dev.infra.pedido.abertos', 'Pedido · Chamados de clientes abertos', 'Nada a preencher; o número é calculado do banco.', 'Chamados novos ou em análise, sem os internos do auditor e sem robôs de teste. Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.pedido.novos', 'Pedido · Novos no período', 'Nada a preencher; o número é calculado do banco.', 'Chamados de clientes criados na janela escolhida. Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.pedido.resp20', 'Pedido · Respondidos em até 20 min', 'Nada a preencher; o número é calculado do banco.', 'Dos novos, quantos tiveram o primeiro movimento (assumido ou respondido) em até 20 minutos. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.pedido.idade', 'Pedido · Idade média dos abertos', 'Nada a preencher; o número é calculado do banco.', 'Há quanto tempo, em média, os chamados abertos esperam. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.constroi.produzidas', 'Code constrói · PRs produzidas', 'Nada a preencher; o número é calculado do banco.', 'PRs abertas na janela (evento "aberta" de erp_dev_entrega). Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.constroi.aberta_pronta', 'Code constrói · Tempo médio aberta → pronta', 'Nada a preencher; o número é calculado do banco.', 'Da abertura da PR até ela ficar pronta (Ready), nas que ficaram prontas na janela. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.esteira.sensiveis', 'Esteira · Sensíveis esperando o revisor', 'Nada a preencher; o número é calculado do banco.', 'PRs da via revisada esperando a autorização do revisor. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.esteira.migrations', 'Esteira · Migrations na fila', 'Nada a preencher; o número é calculado do banco.', 'PRs com migration ainda na rodada (a fila publica uma por vez; lote de até 3). Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.esteira.pronta_pub', 'Esteira · Tempo médio pronta → publicada', 'Nada a preencher; o número é calculado do banco.', 'Da PR ficar pronta até a publicação, nas publicadas na janela. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.esteira.estados', 'Esteira · PRs por estado', 'Nada a preencher; o número é calculado do banco.', 'Retrato da tabela erp_esteira_pr_estado. Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.publicacao.por_hora', 'Publicação · Publicadas por hora', 'Nada a preencher; o número é calculado do banco.', 'PRs publicadas dividido pelas horas da janela. Meta do CEO: 4 por hora. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.publicacao.saldo', 'Publicação · Saldo produzidas − publicadas', 'Nada a preencher; o número é calculado do banco.', 'Positivo = a entrada supera a saída. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.publicacao.main', 'Publicação · Main vermelha', 'Nada a preencher; o número é calculado do banco.', 'Minutos do episódio atual de main vermelha (dentro do dia). Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.auditor.telas', 'Code-Auditor · Telas auditadas', 'Nada a preencher; o número é calculado do banco.', 'Telas com auditoria nova na janela. Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.auditor.vereditos', 'Code-Auditor · Vereditos', 'Nada a preencher; o número é calculado do banco.', 'Vereditos gravados em gold_veredito_triplo. Bronze conta como OK abaixo do ouro; aparece em "Outros". Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.auditor.outros', 'Code-Auditor · Outros vereditos', 'Nada a preencher; o número é calculado do banco.', 'Vereditos que não são OK, piorou, quebrou nem pendente (por exemplo, bronze). Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.auditor.nota', 'Code-Auditor · Nota média do Hub', 'Nada a preencher; o número é calculado do banco.', 'Média de score_evolucao_pct das telas do Hub analisadas na janela. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.volta.abertos', 'Volta · Achados internos abertos', 'Nada a preencher; o número é calculado do banco.', 'Chamados internos do auditor ainda não concluídos, criados na janela. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.volta.fechados', 'Volta · Achados fechados', 'Nada a preencher; o número é calculado do banco.', 'Chamados internos do auditor concluídos na janela. Sem semáforo: é só informação.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.'),
 ('dev.infra.volta.correcao', 'Volta · Tempo médio de correção', 'Nada a preencher; o número é calculado do banco.', 'Da criação do achado até a conclusão, nos concluídos na janela. Limite do semáforo: ver legenda no fim do bloco.', 'Compare "Hoje" com "7 dias" para saber se é pontual ou tendência.', 'Ler um número isolado sem olhar o semáforo e o período.')
) AS v(chave, rotulo, o_que, para_que, exemplo, erro)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
