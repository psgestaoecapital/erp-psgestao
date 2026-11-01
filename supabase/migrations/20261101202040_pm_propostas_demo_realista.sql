-- =============================================================================
-- PDCA P&M · /dashboard/pm/propostas (aud8 93/95) — ÚNICO gap (RD-98 pilar 1, sem lixo de teste):
-- os 3 registros DEMO eram "[BOT] Proposta rascunho/aprovada/recusada" (valor fixo 1500, SEM
-- cliente_id, SEM itens no jsonb) — pareciam lixo de teste, não propostas reais.
--
-- Prova no dado (RD-38, 31/10): empresa DEMO P&M b0700000-...-002 tinha 3 propostas, todas "[BOT]",
-- cliente_id NULL. O cliente realista da jornada ("Clínica Sorriso Vale") já existe no cadastro
-- (fn_demo_seed_pm_jornada). Esta migration liga as propostas a ele.
--
-- O quê (aditivo, sem apagar dado de cliente):
--   1. fn_gold_pm_seed_reparar: troca o bloco de propostas [BOT] por 4 propostas REALISTAS, cobrindo
--      os 4 status da tela (rascunho/enviada/aprovada/recusada), com título de verdade, cliente do
--      cadastro (Clínica Sorriso Vale, com fallback p/ o cliente da sandbox), itens no jsonb + em
--      agency_proposta_itens e valores plausíveis. Idempotente por numero. Resto da função INTACTO.
--   2. Aplicação única na DEMO de produção: as [BOT] antigas saem por SOFT-DELETE (deleted_at — a tela
--      filtra deleted_at IS NULL; reversível, nada é apagado de vez) e as 4 realistas são semeadas.
--
-- RD-96: nomes/fluxo próprios (agência fictícia), nada decalcado de concorrente.
-- Segurança: SECURITY DEFINER, REVOKE anon/public/authenticated, GRANT service_role; grava só na
-- empresa-bot fixa (p_company_id <> v_bot é recusado), por isso a escotilha consciente de guarda.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_gold_pm_seed_reparar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
-- ci-sem-guarda: fn_gold_pm_seed_reparar — grava só na empresa-bot/demo fixa da P&M (p_company_id <> v_bot é recusado); sem GRANT a usuário, roda pelo service_role (gold/seed)
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000002';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_erp_cli uuid; v_ag_cli uuid; v_prop uuid; v_job uuid;
  v_etapa text; v_st text;
  v_jornada jsonb;
  v_cli_demo uuid; v_erp_demo uuid; v_tot numeric; v_pr record;
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

  -- Propostas REALISTAS (PDCA aud8 93/95): cliente do cadastro (Clínica Sorriso Vale, com fallback p/ a
  -- sandbox), 4 status da tela, itens no jsonb + agency_proposta_itens, valores plausíveis. Idempotente por numero.
  SELECT id, erp_cliente_id INTO v_cli_demo, v_erp_demo
    FROM agency_clientes WHERE company_id=v_bot AND nome='Clínica Sorriso Vale' LIMIT 1;
  IF v_cli_demo IS NULL THEN v_cli_demo := v_ag_cli; v_erp_demo := v_erp_cli; END IF;

  FOR v_pr IN
    SELECT * FROM (VALUES
      ('PROP-DEMO-001','aprovada','Gestão de redes sociais — plano mensal','30 dias após aprovação',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','recorrente','descricao','Social media — gestão mensal (feed + stories)','quantidade',1,'unidade','mes','valor_unitario',2500,'valor_total',2500),
          jsonb_build_object('tipo_servico','pacote','descricao','Pacote de design de posts (12 peças)','quantidade',1,'unidade','pacote','valor_unitario',1200,'valor_total',1200))),
      ('PROP-DEMO-002','enviada','Campanha de clareamento dental — mídia paga','50% na aprovação + 50% na entrega',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Criação de campanha (peças + copy)','quantidade',1,'unidade','un','valor_unitario',2800,'valor_total',2800),
          jsonb_build_object('tipo_servico','recorrente','descricao','Gestão de tráfego pago (1 mês)','quantidade',1,'unidade','mes','valor_unitario',1500,'valor_total',1500))),
      ('PROP-DEMO-003','rascunho','Reformulação do site + agendamento online','À vista com 5% de desconto',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Landing page institucional','quantidade',1,'unidade','un','valor_unitario',5200,'valor_total',5200),
          jsonb_build_object('tipo_servico','pontual','descricao','Integração de agendamento online','quantidade',1,'unidade','un','valor_unitario',1800,'valor_total',1800))),
      ('PROP-DEMO-004','recusada','Vídeo institucional 60s para a clínica','40% na aprovação + 60% na entrega',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Roteiro e gravação','quantidade',1,'unidade','un','valor_unitario',4500,'valor_total',4500),
          jsonb_build_object('tipo_servico','pontual','descricao','Edição e finalização','quantidade',1,'unidade','un','valor_unitario',1500,'valor_total',1500)))
    ) AS t(numero,status,titulo,cond,itens)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_propostas WHERE company_id=v_bot AND numero=v_pr.numero) THEN
      SELECT COALESCE(sum((it->>'valor_total')::numeric),0) INTO v_tot FROM jsonb_array_elements(v_pr.itens) it;
      INSERT INTO agency_propostas (company_id, numero, titulo, cliente_id, erp_cliente_id, itens,
          valor_total, desconto, valor_final, condicao_pagamento, status, data_envio, data_aprovacao)
      VALUES (v_bot, v_pr.numero, v_pr.titulo, v_cli_demo, v_erp_demo, v_pr.itens,
          v_tot, 0, v_tot, v_pr.cond, v_pr.status,
          CASE WHEN v_pr.status IN ('enviada','aprovada','recusada') THEN now() - interval '6 days' END,
          CASE WHEN v_pr.status = 'aprovada' THEN now() - interval '2 days' END)
      RETURNING id INTO v_prop;
      INSERT INTO agency_proposta_itens (company_id, proposta_id, ordem, descricao, tipo_servico, unidade, quantidade, valor_unitario)
      SELECT v_bot, v_prop, (row_number() OVER ())::int,
             it->>'descricao', it->>'tipo_servico', it->>'unidade',
             (it->>'quantidade')::numeric, (it->>'valor_unitario')::numeric
      FROM jsonb_array_elements(v_pr.itens) it;
      v_criou:=v_criou+1;
    END IF;
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

REVOKE EXECUTE ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) FROM anon, public, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) TO service_role;

-- Aplicação única na DEMO de produção: tira as [BOT] antigas da lista (soft-delete, reversível) e
-- semeia as 4 realistas AGORA (sem rodar a jornada pesada). Idempotente.
DO $$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000002';
  v_cli_demo uuid; v_erp_demo uuid; v_tot numeric; v_prop uuid; v_pr record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id=v_bot) THEN RETURN; END IF;

  -- [BOT] Proposta * saem da lista (a tela filtra deleted_at IS NULL) — nada é apagado de vez.
  UPDATE agency_propostas SET deleted_at = COALESCE(deleted_at, now())
    WHERE company_id=v_bot AND titulo LIKE '[BOT] Proposta %' AND deleted_at IS NULL;

  SELECT id, erp_cliente_id INTO v_cli_demo, v_erp_demo
    FROM agency_clientes WHERE company_id=v_bot AND nome='Clínica Sorriso Vale' LIMIT 1;
  IF v_cli_demo IS NULL THEN
    SELECT id, erp_cliente_id INTO v_cli_demo, v_erp_demo
      FROM agency_clientes WHERE company_id=v_bot AND nome='[BOT] Cliente Agência' LIMIT 1;
  END IF;
  IF v_cli_demo IS NULL THEN RETURN; END IF;

  FOR v_pr IN
    SELECT * FROM (VALUES
      ('PROP-DEMO-001','aprovada','Gestão de redes sociais — plano mensal','30 dias após aprovação',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','recorrente','descricao','Social media — gestão mensal (feed + stories)','quantidade',1,'unidade','mes','valor_unitario',2500,'valor_total',2500),
          jsonb_build_object('tipo_servico','pacote','descricao','Pacote de design de posts (12 peças)','quantidade',1,'unidade','pacote','valor_unitario',1200,'valor_total',1200))),
      ('PROP-DEMO-002','enviada','Campanha de clareamento dental — mídia paga','50% na aprovação + 50% na entrega',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Criação de campanha (peças + copy)','quantidade',1,'unidade','un','valor_unitario',2800,'valor_total',2800),
          jsonb_build_object('tipo_servico','recorrente','descricao','Gestão de tráfego pago (1 mês)','quantidade',1,'unidade','mes','valor_unitario',1500,'valor_total',1500))),
      ('PROP-DEMO-003','rascunho','Reformulação do site + agendamento online','À vista com 5% de desconto',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Landing page institucional','quantidade',1,'unidade','un','valor_unitario',5200,'valor_total',5200),
          jsonb_build_object('tipo_servico','pontual','descricao','Integração de agendamento online','quantidade',1,'unidade','un','valor_unitario',1800,'valor_total',1800))),
      ('PROP-DEMO-004','recusada','Vídeo institucional 60s para a clínica','40% na aprovação + 60% na entrega',
        jsonb_build_array(
          jsonb_build_object('tipo_servico','pontual','descricao','Roteiro e gravação','quantidade',1,'unidade','un','valor_unitario',4500,'valor_total',4500),
          jsonb_build_object('tipo_servico','pontual','descricao','Edição e finalização','quantidade',1,'unidade','un','valor_unitario',1500,'valor_total',1500)))
    ) AS t(numero,status,titulo,cond,itens)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_propostas WHERE company_id=v_bot AND numero=v_pr.numero) THEN
      SELECT COALESCE(sum((it->>'valor_total')::numeric),0) INTO v_tot FROM jsonb_array_elements(v_pr.itens) it;
      INSERT INTO agency_propostas (company_id, numero, titulo, cliente_id, erp_cliente_id, itens,
          valor_total, desconto, valor_final, condicao_pagamento, status, data_envio, data_aprovacao)
      VALUES (v_bot, v_pr.numero, v_pr.titulo, v_cli_demo, v_erp_demo, v_pr.itens,
          v_tot, 0, v_tot, v_pr.cond, v_pr.status,
          CASE WHEN v_pr.status IN ('enviada','aprovada','recusada') THEN now() - interval '6 days' END,
          CASE WHEN v_pr.status = 'aprovada' THEN now() - interval '2 days' END)
      RETURNING id INTO v_prop;
      INSERT INTO agency_proposta_itens (company_id, proposta_id, ordem, descricao, tipo_servico, unidade, quantidade, valor_unitario)
      SELECT v_bot, v_prop, (row_number() OVER ())::int,
             it->>'descricao', it->>'tipo_servico', it->>'unidade',
             (it->>'quantidade')::numeric, (it->>'valor_unitario')::numeric
      FROM jsonb_array_elements(v_pr.itens) it;
    END IF;
  END LOOP;
END $$;
