-- P&M · /dashboard/pm/contratos ("Contratos / Fee") — PDCA auditor_pdca_2 (DEMO Agência …002): BLOQUEADO.
-- PROVA NO DADO (RD-38): na DEMO havia agency_contratos criado, mas agency_contrato_itens = 0 → o NÚCLEO da tela
--   (contratado × realizado POR serviço/período, com semáforo em dia/a menos/a mais) ficava sem dado = tela morta
--   (RD-98 pilar 1), embora o código (vincular GE, planejar mês, esteira briefing→plano→jobs) já esteja pronto.
--
-- Causa real (provado em transação ROLLBACK, contexto do seed): a jornada DEMO (fn_demo_seed_pm_jornada) cria o
--   contrato da GE (DEMO-PM-FEE-01, ativo) e o fee na P&M (agency_contratos), mas NUNCA criava os ITENS contratados.
--   O gatilho que normalmente geraria o fee+itens a partir do contrato (trg_erp_contrato_fee_pm / fn_pm_fee_gerar_do_contrato,
--   PR F1) cai no handler de exceção para ESTE contrato demo (evento 'fee_erro'), então o item "objeto do contrato" não
--   entra e o fee fica sem linha de serviço. Resultado medido: agency_contratos = 1, agency_contrato_itens = 0.
--   (A causa do fee_erro é do núcleo PR F1 — fica anotada para a jordana-code; esta PR NÃO altera aquele gatilho.)
--
-- Correção (aditiva ao COMPORTAMENTO da própria seed da jornada, idempotente): depois de garantir o fee (v_ag_contr),
--   semeia os itens contratados que espelham o escopo do fee ("Social media + 1 campanha/mês: 8 peças de feed + 4 reels",
--   fee R$ 3.500/mês). Com os itens, o contratado × realizado da tela passa a ter o que comparar com os jobs reais
--   (Carrossel concluído, Reels em produção) já semeados pela própria jornada.
--   · Idempotente pelo marcador origem='demo-jornada' (reaplica sem duplicar).
--   · Só a empresa DEMO fixa da P&M (a função inteira já recusa qualquer outra; is_demo).
--   · Durável: a função é chamada em todo fn_demo_reset(…002) via fn_gold_pm_seed_reparar — os itens voltam a cada reset.
--
-- RD-52: arquivo em supabase/migrations/, versão acima da main (segundos :45, faixa desenvolvedor_4_g). CREATE OR REPLACE
--   da função de seed demo da P&M (sensível por tocar comportamento de seed) → revisao-eng-chefe + MERGE AUTORIZADO.
-- Definição VIVA lida com pg_get_functiondef antes de reescrever (CLAUDE.md). Só o bloco (3b) é novo; o resto é idêntico.
-- Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_jornada(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_demo_seed_pm_jornada — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_ceo  uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes  date;  v_ant date;  v_ini date;
  v_cli agency_clientes%ROWTYPE;
  v_erp_contr uuid; v_ag_contr uuid; v_brief uuid; v_serv_car uuid; v_serv_reels uuid;
  v_job1 uuid; v_job2 uuid; v_tar uuid; v_rec uuid;
  r record; v_criou int := 0; v_tit int := 0; v_lig int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  v_mes := date_trunc('month', v_hoje)::date;
  v_ant := (v_mes - interval '1 month')::date;
  v_ini := (v_mes - interval '2 months')::date;

  -- (1) CLIENTE — o da DEMO (agency_clientes ligado ao erp_clientes da GE)
  SELECT * INTO v_cli FROM agency_clientes WHERE company_id = v_demo AND nome = 'Clínica Sorriso Vale' LIMIT 1;
  IF v_cli.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente_da_jornada_ausente');
  END IF;

  -- (2) FEE = contrato na GE (erp_contratos, como o fn_agency_proposta_aprovar cria) + contrato da P&M ligado a ele
  SELECT id INTO v_erp_contr FROM erp_contratos WHERE company_id = v_demo AND numero = 'DEMO-PM-FEE-01';
  IF v_erp_contr IS NULL THEN
    INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, tipo, natureza, nome, descricao,
        valor_mensal, valor_atual, data_inicio, dia_vencimento, periodicidade, status, forma_pagamento, observacoes)
    VALUES (v_demo, 'DEMO-PM-FEE-01', v_cli.erp_cliente_id, v_cli.nome, 'agencia_pm', 'receita',
        'Fee mensal — Clínica Sorriso Vale', 'Social media + 1 campanha por mês (8 peças de feed, 4 reels)',
        3500, 3500, v_ini, 10, 'mensal', 'ativo', 'boleto', 'demo-jornada')
    RETURNING id INTO v_erp_contr;
    v_criou := v_criou + 1;
  ELSE
    UPDATE erp_contratos SET status = 'ativo', excluido_em = NULL, data_inicio = LEAST(data_inicio, v_ini)
     WHERE id = v_erp_contr AND (status IS DISTINCT FROM 'ativo' OR excluido_em IS NOT NULL OR data_inicio > v_ini);
  END IF;

  SELECT id INTO v_ag_contr FROM agency_contratos WHERE company_id = v_demo AND erp_contrato_id = v_erp_contr LIMIT 1;
  IF v_ag_contr IS NULL THEN
    INSERT INTO agency_contratos (company_id, cliente_id, erp_cliente_id, erp_contrato_id, tipo, fee_mensal,
        dia_vencimento, data_inicio, status, documentacao_ok, observacoes)
    VALUES (v_demo, v_cli.id, v_cli.erp_cliente_id, v_erp_contr, 'recorrente', 3500, 10, v_ini, 'ativo', true, 'demo-jornada')
    RETURNING id INTO v_ag_contr;
    v_criou := v_criou + 1;
  END IF;
  UPDATE agency_clientes SET contrato_id = v_erp_contr, fee_mensal = 3500, updated_at = now()
   WHERE id = v_cli.id AND contrato_id IS DISTINCT FROM v_erp_contr;

  -- (3) BRIEFING do cliente, que virou job
  SELECT id INTO v_brief FROM agency_briefings WHERE company_id = v_demo AND titulo = 'Campanha clareamento — mês passado';
  IF v_brief IS NULL THEN
    INSERT INTO agency_briefings (company_id, cliente_id, titulo, descricao, objetivo, publico_alvo, prazo_desejado,
        orcamento_estimado, tipo_servico, prioridade, status, solicitante)
    VALUES (v_demo, v_cli.id, 'Campanha clareamento — mês passado',
        'Carrossel educativo + reels de antes e depois para a campanha de clareamento.',
        'Agendar 30 avaliações no mês', 'Adultos 25–45 anos da região', v_ant + 14, 3500, 'social_media', 'alta',
        'virou_job', 'Recepção da clínica')
    RETURNING id INTO v_brief;
    v_criou := v_criou + 1;
  END IF;

  SELECT id INTO v_serv_car   FROM agency_servico WHERE company_id = v_demo AND nome = 'Carrossel' LIMIT 1;
  SELECT id INTO v_serv_reels FROM agency_servico WHERE company_id = v_demo AND nome = 'Reels' LIMIT 1;

  -- (3b) ITENS CONTRATADOS do fee — o que a tela /dashboard/pm/contratos compara com o realizado (por serviço/período).
  --      Sem eles o núcleo da tela fica vazio (RD-98 p1 · tela morta). Espelham o escopo do fee (8 peças de feed + 4 reels,
  --      R$ 3.500/mês). Idempotente pelo marcador origem='demo-jornada'. servico_id pode ficar nulo (coluna aceita).
  IF v_ag_contr IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agency_contrato_itens WHERE contrato_id = v_ag_contr AND origem = 'demo-jornada') THEN
    INSERT INTO agency_contrato_itens (company_id, contrato_id, servico_id, tipo_servico, quantidade_contratada, unidade,
        periodicidade, valor_unitario, origem, confirmado)
    VALUES
      (v_demo, v_ag_contr, v_serv_car,   'Carrossel (feed)', 8, 'peça',  'mensal', 250, 'demo-jornada', true),
      (v_demo, v_ag_contr, v_serv_reels, 'Reels',            4, 'vídeo', 'mensal', 375, 'demo-jornada', true);
    v_criou := v_criou + 2;
  END IF;

  -- (4) JOBS do fee: um entregue (aprovado pelo cliente) e um em produção
  SELECT id INTO v_job1 FROM agency_jobs WHERE company_id = v_demo AND 'demo-jornada' = ANY (tags) AND titulo = 'Carrossel — 5 mitos do clareamento' LIMIT 1;
  IF v_job1 IS NULL THEN
    INSERT INTO agency_jobs (company_id, cliente_id, briefing_id, contrato_id, fee_id, servico_id, titulo, descricao, tipo,
        status, prioridade, responsavel_id, data_inicio, data_prazo, data_entrega, valor_job, horas_estimadas, tags)
    VALUES (v_demo, v_cli.id, v_brief, v_ag_contr, v_ag_contr, v_serv_car, 'Carrossel — 5 mitos do clareamento',
        'Carrossel de 6 telas para o feed, com chamada para agendar avaliação.', 'carrossel',
        'concluida', 'alta', CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = v_robo) THEN v_robo END,
        v_ant + 2, v_ant + 10, v_ant + 9, 1800, 9, ARRAY['demo-jornada'])
    RETURNING id INTO v_job1;
    v_criou := v_criou + 1;
  END IF;
  SELECT id INTO v_job2 FROM agency_jobs WHERE company_id = v_demo AND 'demo-jornada' = ANY (tags) AND titulo = 'Reels — antes e depois' LIMIT 1;
  IF v_job2 IS NULL THEN
    INSERT INTO agency_jobs (company_id, cliente_id, briefing_id, contrato_id, fee_id, servico_id, titulo, descricao, tipo,
        status, prioridade, responsavel_id, data_inicio, data_prazo, valor_job, horas_estimadas, tags)
    VALUES (v_demo, v_cli.id, v_brief, v_ag_contr, v_ag_contr, v_serv_reels, 'Reels — antes e depois',
        'Reels de 30 s com depoimento e antes/depois (autorizado pelo paciente fictício).', 'reels',
        'em_producao', 'media', CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = v_robo) THEN v_robo END,
        v_mes, v_mes + 12, 1700, 8, ARRAY['demo-jornada'])
    RETURNING id INTO v_job2;
    v_criou := v_criou + 1;
  END IF;
  UPDATE agency_jobs SET excluido_em = NULL, excluido_por = NULL WHERE id IN (v_job1, v_job2) AND excluido_em IS NOT NULL;

  -- (5) TAREFAS e (6) HORAS apontadas e aprovadas, com o custo/hora da equipe (agency_equipe);
  --     custo_total é coluna gerada (horas × custo_hora); apontamento FECHADO (fim_em), nunca cronômetro aberto
  FOR r IN SELECT * FROM (VALUES
      (1, 'Roteiro e texto das 6 telas',  'concluida', v_robo, 2.5, 1),
      (1, 'Arte do carrossel',            'concluida', v_robo, 3.5, 3),
      (1, 'Revisão e envio ao cliente',   'concluida', v_ceo,  1.0, 5),
      (2, 'Roteiro do reels',             'concluida', v_robo, 1.5, 0),
      (2, 'Captação e edição',            'pendente',  v_robo, 2.0, 2)
    ) t(job, titulo, status, dono, horas, dia) LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = r.dono);
    SELECT id INTO v_tar FROM agency_tarefas
     WHERE company_id = v_demo AND job_id = CASE r.job WHEN 1 THEN v_job1 ELSE v_job2 END AND titulo = r.titulo LIMIT 1;
    IF v_tar IS NULL THEN
      INSERT INTO agency_tarefas (company_id, job_id, titulo, responsavel_id, status, ordem, data_inicio, data_prazo,
          data_conclusao, horas_estimadas, horas_realizadas)
      VALUES (v_demo, CASE r.job WHEN 1 THEN v_job1 ELSE v_job2 END, r.titulo, r.dono, r.status, r.dia,
          CASE r.job WHEN 1 THEN v_ant ELSE v_mes END + r.dia, CASE r.job WHEN 1 THEN v_ant ELSE v_mes END + r.dia + 2,
          CASE WHEN r.status = 'concluida' THEN CASE r.job WHEN 1 THEN v_ant ELSE v_mes END + r.dia + 1 END,
          r.horas, r.horas)
      RETURNING id INTO v_tar;
      v_criou := v_criou + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM agency_timesheet WHERE company_id = v_demo AND tarefa_id = v_tar AND descricao = 'demo-jornada') THEN
      INSERT INTO agency_timesheet (company_id, job_id, tarefa_id, user_id, cliente_id, data, horas, descricao,
          tipo_atividade, custo_hora, inicio_em, fim_em, aprovado, aprovado_por)
      SELECT v_demo, CASE r.job WHEN 1 THEN v_job1 ELSE v_job2 END, v_tar, r.dono, v_cli.id,
             CASE r.job WHEN 1 THEN v_ant ELSE v_mes END + r.dia, r.horas, 'demo-jornada', 'producao',
             e.ch, e.ini, e.ini + make_interval(mins => (r.horas * 60)::int),
             (r.job = 1), CASE WHEN r.job = 1 AND EXISTS (SELECT 1 FROM users WHERE id = v_ceo) THEN v_ceo END
        FROM (SELECT (SELECT custo_hora FROM agency_equipe WHERE company_id = v_demo AND user_id = r.dono AND ativo LIMIT 1) ch,
                     ((CASE r.job WHEN 1 THEN v_ant ELSE v_mes END + r.dia) + time '09:00') AT TIME ZONE 'America/Sao_Paulo' ini) e;
      v_criou := v_criou + 1;
    END IF;
  END LOOP;

  -- (7) APROVAÇÃO DO CLIENTE do job entregue (rodada 1, aprovado no prazo)
  IF NOT EXISTS (SELECT 1 FROM agency_aprovacoes WHERE job_id = v_job1 AND rodada = 1) THEN
    INSERT INTO agency_aprovacoes (company_id, job_id, rodada, enviado_em, prazo_em, decisao, decidido_em)
    VALUES (v_demo, v_job1, 1, (v_ant + 8)::timestamp AT TIME ZONE 'America/Sao_Paulo',
            (v_ant + 10)::timestamp AT TIME ZONE 'America/Sao_Paulo', 'aprovado',
            (v_ant + 9)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_criou := v_criou + 1;
  END IF;

  -- (8) CUSTO E MARGEM do job: o custo real é a soma das horas aprovadas × custo/hora (a tela Margem por Job
  --     lê o mesmo agency_timesheet); aqui só deixamos o job coerente com o que foi apontado.
  UPDATE agency_jobs j SET horas_realizadas = s.h, custo_real = s.c
    FROM (SELECT job_id, sum(horas) h, sum(custo_total) c FROM agency_timesheet
           WHERE company_id = v_demo AND job_id IN (v_job1, v_job2) AND descricao = 'demo-jornada' GROUP BY job_id) s
   WHERE j.id = s.job_id AND (j.horas_realizadas IS DISTINCT FROM s.h OR j.custo_real IS DISTINCT FROM s.c);

  -- (9) TÍTULO NA GE: fatura do fee no mês passado (recebida) e no mês atual (em aberto), pelo gerador real
  FOR r IN SELECT d FROM unnest(ARRAY[v_ant, v_mes]) d LOOP
    IF (fn_contrato_gerar_receber(v_erp_contr, r.d) ->> 'success')::boolean THEN v_tit := v_tit + 1; END IF;
  END LOOP;
  SELECT id INTO v_rec FROM erp_receber
   WHERE company_id = v_demo AND ref_externa_sistema = 'contrato_recorrente'
     AND ref_externa_id = format('contrato:%s:mes:%s', v_erp_contr, to_char(v_ant, 'YYYY-MM')) AND deleted_at IS NULL;
  IF v_rec IS NOT NULL THEN
    UPDATE erp_receber SET valor_pago = valor, data_pagamento = v_ant + 9, status = 'pago', updated_at = now()
     WHERE id = v_rec AND data_pagamento IS NULL;
  END IF;

  -- (10) DRE: fee mensal = Receita de Mensalidades/Assinaturas (1.3) e recálculo real dos dois meses
  IF NOT EXISTS (SELECT 1 FROM psgc_depara WHERE company_id = v_demo AND origem_codigo = 'Receita Recorrente') THEN
    INSERT INTO psgc_depara (company_id, origem_codigo, origem_descricao, origem_sistema, psgc_codigo, metodo, confianca, ativo, observacao)
    VALUES (v_demo, 'Receita Recorrente', 'Fee mensal de agência', 'erp', '1.3', 'manual', 100, true, 'demo-jornada');
  END IF;
  FOR r IN SELECT d FROM unnest(ARRAY[v_ant, v_mes]) d LOOP
    PERFORM fn_psgc_recalcular_dre_mes(v_demo, extract(year FROM r.d)::int, extract(month FROM r.d)::int);
  END LOOP;

  -- (11) MAPA DE LIGAÇÕES do PDCA (vertical pm, dono jordana-code). Cada SQL devolve (esperado, encontrado);
  --      esperado nunca é 0 (GREATEST 1), para que DEMO vazia dê vermelho e não verde.
  IF to_regclass('public.pdca_ligacao') IS NOT NULL THEN
    INSERT INTO pdca_ligacao (vertical, codigo, origem_rota, acao, destino_rota, deve_aparecer, sql_conferencia, code_dono) VALUES
    ('pm','PM-01','/dashboard/pm/contratos','Fechar o fee do cliente','/dashboard/contratos',
     'Todo fee ativo da P&M tem o contrato ativo na GE (agency_contratos.erp_contrato_id)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM erp_contratos e WHERE e.id = c.erp_contrato_id AND e.status = 'ativo' AND e.excluido_em IS NULL))::int FROM agency_contratos c WHERE c.company_id = $1 AND c.status = 'ativo'$q$, 'jordana-code'),
    ('pm','PM-02','/dashboard/pm/briefings','Transformar briefing em job','/dashboard/pm/painel-jobs',
     'Briefing que virou job tem o job ligado (agency_jobs.briefing_id)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM agency_jobs j WHERE j.briefing_id = b.id AND j.excluido_em IS NULL))::int FROM agency_briefings b WHERE b.company_id = $1 AND b.status = 'virou_job'$q$, 'jordana-code'),
    ('pm','PM-03','/dashboard/pm/painel-jobs','Abrir o job do fee','/dashboard/pm/painel-jobs',
     'Job do fee tem tarefas (agency_tarefas)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM agency_tarefas t WHERE t.job_id = j.id))::int FROM agency_jobs j WHERE j.company_id = $1 AND j.contrato_id IS NOT NULL AND j.excluido_em IS NULL$q$, 'jordana-code'),
    ('pm','PM-04','/dashboard/pm/painel-jobs','Concluir tarefa','/dashboard/pm/apontamento-horas',
     'Tarefa concluída de job do fee tem horas apontadas (agency_timesheet.tarefa_id)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM agency_timesheet s WHERE s.tarefa_id = t.id AND s.horas > 0))::int FROM agency_tarefas t JOIN agency_jobs j ON j.id = t.job_id WHERE t.company_id = $1 AND t.status = 'concluida' AND j.contrato_id IS NOT NULL AND j.excluido_em IS NULL$q$, 'jordana-code'),
    ('pm','PM-05','/dashboard/pm/aprovacao','Cliente aprovar o job','/dashboard/pm/painel-jobs',
     'Job do fee concluído/publicado tem a aprovação do cliente (agency_aprovacoes decisao=aprovado)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM agency_aprovacoes a WHERE a.job_id = j.id AND a.decisao = 'aprovado'))::int FROM agency_jobs j WHERE j.company_id = $1 AND j.contrato_id IS NOT NULL AND j.status IN ('concluida','publicado') AND j.excluido_em IS NULL$q$, 'jordana-code'),
    ('pm','PM-06','/dashboard/pm/apontamento-horas','Aprovar horas','/dashboard/pm/margem-job',
     'Hora aprovada de job do fee tem custo/hora (entra no custo e na margem do job)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE s.custo_hora > 0)::int FROM agency_timesheet s JOIN agency_jobs j ON j.id = s.job_id WHERE s.company_id = $1 AND s.aprovado AND j.contrato_id IS NOT NULL AND j.excluido_em IS NULL$q$, 'jordana-code'),
    ('pm','PM-07','/dashboard/contratos','Faturar o fee do mês','/dashboard/financeiro/receber',
     'Fee ativo tem o título do mês atual em Contas a receber (erp_receber.contrato_id)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM erp_receber r WHERE r.company_id = $1 AND r.contrato_id = c.erp_contrato_id AND r.deleted_at IS NULL AND r.data_competencia = date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date))::int FROM agency_contratos c WHERE c.company_id = $1 AND c.status = 'ativo' AND c.erp_contrato_id IS NOT NULL$q$, 'jordana-code'),
    ('pm','PM-08','/dashboard/financeiro/receber','Título do fee na competência','/dashboard/financeiro/dre-consolidado',
     'Todo mês com título de fee tem a DRE por competência calculada (psgc_dre)',
     $q$SELECT GREATEST(count(*),1)::int, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM psgc_dre d WHERE d.company_id = $1 AND d.regime = 'competencia' AND d.ano = extract(year FROM m.mes)::int AND d.mes = extract(month FROM m.mes)::int))::int FROM (SELECT DISTINCT date_trunc('month', r.data_competencia) AS mes FROM erp_receber r JOIN agency_contratos c ON c.erp_contrato_id = r.contrato_id AND c.company_id = $1 WHERE r.company_id = $1 AND r.deleted_at IS NULL AND r.data_competencia IS NOT NULL) m$q$, 'jordana-code')
    ON CONFLICT (vertical, codigo) DO NOTHING;
    GET DIAGNOSTICS v_lig = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'criou', v_criou, 'titulos', v_tit, 'ligacoes', v_lig,
    'contrato_ge', v_erp_contr, 'jobs', jsonb_build_array(v_job1, v_job2));
END $function$;

-- Permissões iguais às de produção (só postgres/service_role).
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_jornada(uuid) FROM PUBLIC, anon, authenticated;

-- Backfill único na aplicação da migration (deploy-migrations, service_role): semeia a DEMO …002 agora, para a tela
-- /dashboard/pm/contratos deixar de ser tela morta sem esperar o próximo fn_demo_reset. Idempotente e is_demo-guarded.
-- Envolto em bloco de exceção: uma eventual falha do seed NUNCA derruba o deploy-migrations (RD-52/pipeline).
DO $$
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM public.fn_demo_seed_pm_jornada('b0700000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'backfill fn_demo_seed_pm_jornada(…002) nao concluiu (nao bloqueia deploy): % / %', SQLSTATE, SQLERRM;
END $$;
