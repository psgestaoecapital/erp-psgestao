-- P&M · DEMO "Agência (P&M) - DEMO" (…02): a JORNADA INTEIRA com dados realistas e anônimos (CEO 09/10, msg c2d861ab).
-- cliente → fee (contrato na GE) → briefing → job → tarefas → apontamento de horas → aprovação do cliente
--   → custo e margem do job → título na GE → DRE.
-- Serve para o PDCA provar a ligação entre as telas e para provar as 3 ondas da P&M (custo por job, horas em
-- 1 toque, carga em horas). Cliente da jornada: "Clínica Sorriso Vale" (já existe na DEMO, nome fictício).
--
-- Reparável (padrão fn_gold_*_seed_reparar): roda em todo fn_demo_reset(…02) via fn_gold_pm_seed_reparar;
-- acha cada peça pelo marcador e só cria o que falta. Usa os caminhos REAIS da GE onde existem:
--   · título do fee = fn_contrato_gerar_receber (o mesmo da tela de contratos; idempotente por mês);
--   · DRE = fn_psgc_recalcular_dre_mes (o recálculo real; a DEMO é is_demo e fica fora das métricas — RD-69).
-- Só a empresa DEMO fixa da P&M (is_demo); qualquer outra é recusada. Nenhum dado de cliente real é tocado.
-- Ligações do mapa do PDCA (pdca_ligacao, #2330 do gilberto-chamados): gravadas aqui, se a tabela já existir;
-- senão o próximo fn_demo_reset grava (a função confere to_regclass a cada rodada).

-- ci-sem-guarda: fn_demo_seed_pm_jornada — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
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

REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_jornada(uuid) FROM PUBLIC, anon, authenticated;

-- fn_gold_pm_seed_reparar (lida VIVA em produção com pg_get_functiondef em 09/10): só acrescenta a chamada da
-- jornada antes do RETURN, para entrar no fn_demo_reset(…02) sem mexer no fn_demo_reset. O resto é idêntico.
-- ci-sem-guarda: fn_gold_pm_seed_reparar — só a empresa-bot fixa da P&M (recusa qualquer outra); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
CREATE OR REPLACE FUNCTION public.fn_gold_pm_seed_reparar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000002';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_erp_cli uuid; v_ag_cli uuid; v_prop uuid; v_job uuid;
  v_etapa text; v_st text;
  v_jornada jsonb;
BEGIN
  -- Só a empresa-bot da P&M. Qualquer outra (incl. PDOIS) é recusada.
  IF p_company_id <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_bot');
  END IF;

  -- Equipe (2, com custo_hora) — margem/apontamento
  IF NOT EXISTS (SELECT 1 FROM agency_equipe WHERE company_id=v_bot AND nome='[BOT] Designer') THEN
    INSERT INTO agency_equipe (company_id, nome, custo_hora) VALUES (v_bot,'[BOT] Designer',50); v_criou:=v_criou+1; END IF;
  IF NOT EXISTS (SELECT 1 FROM agency_equipe WHERE company_id=v_bot AND nome='[BOT] Social Media') THEN
    INSERT INTO agency_equipe (company_id, nome, custo_hora) VALUES (v_bot,'[BOT] Social Media',40); v_criou:=v_criou+1; END IF;

  -- Cliente unificado: erp_clientes (fonte GE) + agency_clientes (extensão via erp_cliente_id)
  SELECT id INTO v_erp_cli FROM erp_clientes WHERE company_id=v_bot AND nome_fantasia='[BOT] Cliente Agência' LIMIT 1;
  IF v_erp_cli IS NULL THEN
    INSERT INTO erp_clientes (company_id, nome_fantasia) VALUES (v_bot,'[BOT] Cliente Agência') RETURNING id INTO v_erp_cli; v_criou:=v_criou+1; END IF;
  SELECT id INTO v_ag_cli FROM agency_clientes WHERE company_id=v_bot AND nome='[BOT] Cliente Agência' LIMIT 1;
  IF v_ag_cli IS NULL THEN
    INSERT INTO agency_clientes (company_id, nome, erp_cliente_id, fee_mensal, tipo_contrato, status)
    VALUES (v_bot,'[BOT] Cliente Agência', v_erp_cli, 3000, 'fee_mensal', 'ativo') RETURNING id INTO v_ag_cli; v_criou:=v_criou+1; END IF;

  -- Catálogo (3): recorrente / pontual / pacote (tipo e modelo_preco pelos CHECKs reais)
  IF NOT EXISTS (SELECT 1 FROM agency_servico WHERE company_id=v_bot AND nome='[BOT] Social Media (recorrente)') THEN
    INSERT INTO agency_servico (company_id,nome,tipo,modelo_preco) VALUES (v_bot,'[BOT] Social Media (recorrente)','recorrente','fee_mensal'); v_criou:=v_criou+1; END IF;
  IF NOT EXISTS (SELECT 1 FROM agency_servico WHERE company_id=v_bot AND nome='[BOT] Landing Page (pontual)') THEN
    INSERT INTO agency_servico (company_id,nome,tipo,modelo_preco) VALUES (v_bot,'[BOT] Landing Page (pontual)','pontual','fixo'); v_criou:=v_criou+1; END IF;
  IF NOT EXISTS (SELECT 1 FROM agency_servico WHERE company_id=v_bot AND nome='[BOT] Branding (pacote)') THEN
    INSERT INTO agency_servico (company_id,nome,tipo,modelo_preco) VALUES (v_bot,'[BOT] Branding (pacote)','pacote','pacote'); v_criou:=v_criou+1; END IF;

  -- Leads: 1 por etapa REAL do funil (as usadas em produção)
  FOREACH v_etapa IN ARRAY ARRAY['novo_atendimento','reuniao','proposta','negociacao','ganho','perdido']::text[] LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_leads WHERE company_id=v_bot AND nome='[BOT] Lead '||v_etapa) THEN
      INSERT INTO agency_leads (company_id, nome, origem, etapa) VALUES (v_bot,'[BOT] Lead '||v_etapa,'indicacao',v_etapa); v_criou:=v_criou+1; END IF;
  END LOOP;

  -- Propostas: 1 por status válido (rascunho/aprovada/recusada) com total = soma dos itens (1000+500=1500)
  FOREACH v_st IN ARRAY ARRAY['rascunho','aprovada','recusada']::text[] LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_propostas WHERE company_id=v_bot AND titulo='[BOT] Proposta '||v_st) THEN
      INSERT INTO agency_propostas (company_id,titulo,valor_total,valor_final,status)
      VALUES (v_bot,'[BOT] Proposta '||v_st,1500,1500,v_st) RETURNING id INTO v_prop;
      INSERT INTO agency_proposta_itens (company_id,proposta_id,ordem,descricao,unidade,quantidade,valor_unitario) VALUES
        (v_bot,v_prop,1,'[BOT] Item — social media','mes',1,1000),
        (v_bot,v_prop,2,'[BOT] Item — design','un',1,500);
      v_criou:=v_criou+1; END IF;
  END LOOP;

  -- Agenda: 1 reunião futura (origem_modulo='pm'), ligada a um lead pelo marcador em dados
  IF NOT EXISTS (SELECT 1 FROM erp_agendamento WHERE company_id=v_bot AND origem_modulo='pm' AND dados->>'marker'='bot-pm') THEN
    INSERT INTO erp_agendamento (company_id, origem_modulo, data, status, dados)
    VALUES (v_bot,'pm', now() + interval '2 days', 'agendado',
            jsonb_build_object('marker','bot-pm','titulo','[BOT] Reunião de proposta','lead_nome','[BOT] Lead reuniao')); v_criou:=v_criou+1; END IF;

  -- Briefing (1)
  IF NOT EXISTS (SELECT 1 FROM agency_briefings WHERE company_id=v_bot AND titulo='[BOT] Briefing inicial') THEN
    INSERT INTO agency_briefings (company_id, titulo) VALUES (v_bot,'[BOT] Briefing inicial'); v_criou:=v_criou+1; END IF;

  -- Jobs: 1 por coluna do kanban (ESTAGIOS de /dashboard/producao)
  FOREACH v_st IN ARRAY ARRAY['nao_iniciada','em_producao','em_aprovacao','concluida','publicado']::text[] LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_jobs WHERE company_id=v_bot AND titulo='[BOT] Job '||v_st) THEN
      INSERT INTO agency_jobs (company_id, titulo, status, cliente_id) VALUES (v_bot,'[BOT] Job '||v_st,v_st,v_ag_cli); v_criou:=v_criou+1; END IF;
  END LOOP;

  -- Timesheet: 1 registro fechado (aprovado) no job concluído — apontamento/margem
  SELECT id INTO v_job FROM agency_jobs WHERE company_id=v_bot AND titulo='[BOT] Job concluida' LIMIT 1;
  IF v_job IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agency_timesheet WHERE company_id=v_bot AND job_id=v_job) THEN
    INSERT INTO agency_timesheet (company_id, job_id, user_id, data, horas, aprovado)
    VALUES (v_bot, v_job, v_robo, current_date, 4, true); v_criou:=v_criou+1; END IF;

  -- Jornada inteira com dados realistas (cliente → fee na GE → briefing → job → tarefas → horas → aprovação
  -- → margem → título → DRE) e ligações do PDCA — CEO 09/10, msg c2d861ab.
  v_jornada := fn_demo_seed_pm_jornada(v_bot);

  RETURN jsonb_build_object('ok', true, 'company_id', v_bot, 'criou', v_criou, 'jornada', v_jornada);
END $function$;

-- Permissões iguais às de produção (só postgres/service_role).
REVOKE ALL ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) FROM PUBLIC, anon, authenticated;
