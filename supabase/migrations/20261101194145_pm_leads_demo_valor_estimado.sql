-- PM / Leads (CRM) — RD-98 p1: a tela de Leads não pode ficar morta na DEMO.
-- Veredito PDCA (auditor_pdca_2, #baa3c770): o KPI "Pipeline" da DEMO Agência ficava em
-- R$ 0,00 porque os leads vivos do seed-gold ([BOT] Lead <etapa>) nasciam sem valor_estimado
-- e sem proposta viva ligada. O Pipeline soma o valor_estimado dos leads em etapa aberta
-- (fallback: maior proposta viva ligada) — sem valor, a tela demonstra R$ 0.
--
-- Correção DURÁVEL (sobrevive ao fn_demo_reset): a função que (re)cria os leads do bot
-- passa a gravar um valor_estimado realista por etapa. Mantemos os NOMES "[BOT] Lead <etapa>"
-- (o explorador Gold depende deles) — só acrescentamos o valor. Backfill dos já existentes.
-- Também arquiva (soft-delete) os leads de teste E2E ("Maria Teste") que poluíam o funil DEMO.
--
-- Aditiva: só CREATE OR REPLACE da função de seed-gold + UPDATE guardado na empresa-bot da DEMO.
-- Nenhuma tabela/coluna nova; nenhum dado de cliente real tocado (só company-bot DEMO).
-- Code: desenvolvedor_4_g

-- ci-sem-guarda: fn_gold_pm_seed_reparar só grava na empresa-bot DEMO fixa (b0700000-0000-4000-a000-000000000002); recusa qualquer outro p_company_id com so_empresa_bot. Sem empresa de cliente a guardar (check-fn-guards regra 4 grava_sem_guarda_empresa).
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

  -- Leads: 1 por etapa REAL do funil (as usadas em produção).
  -- valor_estimado realista por etapa → KPI Pipeline deixa de ser R$ 0 (RD-98 p1).
  FOREACH v_etapa IN ARRAY ARRAY['novo_atendimento','reuniao','proposta','negociacao','ganho','perdido']::text[] LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_leads WHERE company_id=v_bot AND nome='[BOT] Lead '||v_etapa) THEN
      INSERT INTO agency_leads (company_id, nome, origem, etapa, valor_estimado)
      VALUES (v_bot,'[BOT] Lead '||v_etapa,'indicacao',v_etapa,
        CASE v_etapa
          WHEN 'novo_atendimento' THEN 8000
          WHEN 'reuniao'          THEN 12000
          WHEN 'proposta'         THEN 18000
          WHEN 'negociacao'       THEN 25000
          WHEN 'ganho'            THEN 30000
          WHEN 'perdido'          THEN 6000
          ELSE NULL
        END);
      v_criou:=v_criou+1; END IF;
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

-- Backfill: leads [BOT] já existentes na empresa-bot DEMO ganham o valor_estimado por etapa
-- (só onde está NULL; guardado ao v_bot; idempotente).
UPDATE public.agency_leads
   SET valor_estimado = CASE etapa
          WHEN 'novo_atendimento' THEN 8000
          WHEN 'reuniao'          THEN 12000
          WHEN 'proposta'         THEN 18000
          WHEN 'negociacao'       THEN 25000
          WHEN 'ganho'            THEN 30000
          WHEN 'perdido'          THEN 6000
          ELSE valor_estimado
       END,
       atualizado_em = now()
 WHERE company_id = 'b0700000-0000-4000-a000-000000000002'
   AND nome LIKE '[BOT] Lead %'
   AND valor_estimado IS NULL
   AND deleted_at IS NULL
   AND etapa IN ('novo_atendimento','reuniao','proposta','negociacao','ganho','perdido');

-- Arquiva (soft-delete) os leads de teste E2E deixados no funil DEMO ("Maria Teste" / "E2E ..."),
-- que apareciam sem valor e poluíam a vitrine. Guardado ao v_bot; idempotente.
UPDATE public.agency_leads
   SET deleted_at = now(), atualizado_em = now()
 WHERE company_id = 'b0700000-0000-4000-a000-000000000002'
   AND deleted_at IS NULL
   AND nome = 'Maria Teste'
   AND empresa LIKE 'E2E %';

-- check-fn-guards regra 1 (revoke_anon): SECURITY DEFINER exige REVOKE explícito no arquivo.
-- CREATE OR REPLACE preserva a ACL viva ({postgres,service_role}); as linhas abaixo só a refletem.
REVOKE ALL ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) TO postgres, service_role;
