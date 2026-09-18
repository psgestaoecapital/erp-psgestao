-- =============================================================================
-- P&M V5 · Parte C (PR-2) — Sandbox [BOT] Agência para o Gold (mesma receita da Oficina)
-- Referência: 20260914120000_gold_oficina_bot_seed.sql + EMPRESA_BOT_OFICINA em auditar-rota.
--
-- Regras honradas:
--   ZERO escrita na PDOIS (36b69d77): o seed recusa qualquer company_id ≠ bot.
--   RD-30: nada dropado. RD-52: idempotente (2ª execução insere 0).
--   Segurança (#1537): fn SECURITY DEFINER, REVOKE anon/public/authenticated, GRANT service_role.
--   NÃO semeia erp_contratos/erp_receber/erp_pagar/NFS-e (P3/P4 não existem; evita motor de recorrência).
--   Menu: NÃO mexe em tenant_subscriptions. O robô screenshot@ é system_role=PS_ADMIN (isento do
--     gating de área/assinatura em fn_modulos_sidebar_por_area e AreaRedirectGuard) e o auditor navega
--     direto na rota — não depende do menu. Caminho não comercial, como o LEIA-ME permite (C3).
-- ambiente_tenant='auditoria' já está no CHECK de companies (posto pela migration da Oficina).
-- =============================================================================

-- C1 · empresa-bot da P&M (id fixo, sintética, isolada por ambiente_tenant='auditoria')
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
VALUES ('b0700000-0000-4000-a000-000000000002', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        '[BOT] Agência — auditoria Gold', '[BOT] Agência — auditoria Gold', true, 'auditoria')
ON CONFLICT (id) DO UPDATE SET is_demo = true, ambiente_tenant = 'auditoria',
  restrita_ps_admin = false, razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia;

-- C2 · acesso do robô (screenshot@) à empresa-bot
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa', 'b0700000-0000-4000-a000-000000000002', 'adm'
WHERE NOT EXISTS (SELECT 1 FROM public.user_companies
  WHERE user_id='74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa' AND company_id='b0700000-0000-4000-a000-000000000002');

-- C4 · seed idempotente e auto-reparável (recria só o que faltar; 2ª execução insere 0)
CREATE OR REPLACE FUNCTION public.fn_gold_pm_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000002';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_erp_cli uuid; v_ag_cli uuid; v_prop uuid; v_job uuid;
  v_etapa text; v_st text;
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

  RETURN jsonb_build_object('ok', true, 'company_id', v_bot, 'criou', v_criou);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) FROM anon, public, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_gold_pm_seed_reparar(uuid) TO service_role;

-- C6 · Botões Gold das telas reais (has-text com o texto REAL do código; cascas = 0 botões).
-- screen_id resolvido por JOIN em system_screens pela rota (as rotas novas vêm do PR-1; INNER JOIN
-- só cria onde a tela existe). Idempotente por (screen_id, botao_label).
INSERT INTO public.gold_screen_buttons (screen_id, rota, botao_label, botao_selector_css, tipo, prioridade, precondicao)
SELECT s.id, v.rota, v.label, v.selector, v.tipo, v.prioridade, v.precond
FROM (VALUES
  ('/dashboard/pm',                'Ir para Comercial',        'a:has-text("Comercial")',            'navegacao','normal',  NULL),
  ('/dashboard/pm/leads',          'Novo lead',                'button:has-text("Novo lead")',       'modal',    'critico', NULL),
  ('/dashboard/pm/leads',          'Nova proposta',            'button:has-text("Nova proposta")',   'modal',    'normal',  NULL),
  ('/dashboard/pm/leads',          'Abrir card do lead [BOT]', 'text=[BOT] Lead proposta',           'modal',    'normal',  'requer ao menos um lead [BOT]'),
  ('/dashboard/pm/leads',          'Ganhar o lead [BOT]',      'button:has-text("Ganhar")',          'acao',     'normal',  'requer um lead [BOT] em etapa aberta'),
  ('/dashboard/pm/leads',          'Perder o lead [BOT]',      'button:has-text("Perder")',          'acao',     'opcional','requer um lead [BOT] em etapa aberta'),
  ('/dashboard/pm/propostas',      'Nova proposta',            'button:has-text("Nova proposta")',   'modal',    'critico', NULL),
  ('/dashboard/pm/propostas',      'Abrir proposta [BOT]',     'text=[BOT] Proposta rascunho',       'modal',    'normal',  'requer proposta [BOT]'),
  ('/dashboard/pm/propostas',      'Editar proposta [BOT]',    'button:has-text("Editar")',          'modal',    'normal',  'requer proposta [BOT] aberta'),
  ('/dashboard/pm/propostas',      'Enviar proposta [BOT]',    'button:has-text("Enviar")',          'acao',     'normal',  'requer proposta [BOT] aberta'),
  ('/dashboard/pm/servicos',       'Novo serviço',             'button:has-text("Novo serviço")',    'modal',    'critico', NULL),
  ('/dashboard/pm/agenda',         'Novo agendamento',         'button:has-text("Novo")',            'modal',    'normal',  NULL),
  ('/dashboard/pm/agenda',         'Abrir card do lead',       'button:has-text("Abrir card do lead")','navegacao','opcional','requer agendamento ligado a lead'),
  ('/dashboard/pm/briefings',      'Novo briefing',            'button:has-text("Novo briefing")',   'modal',    'critico', NULL),
  ('/dashboard/pm/aprovacao',      'Aprovar job [BOT]',        'button:has-text("Aprovar")',         'acao',     'critico', 'requer job [BOT] em aprovação'),
  ('/dashboard/pm/apontamento-horas','Iniciar cronômetro',     'button:has-text("Iniciar cronômetro")','acao',   'critico', 'requer job [BOT]'),
  ('/dashboard/pm/apontamento-horas','Parar e gravar',         'button:has-text("Parar e gravar")',  'acao',     'normal',  'requer cronômetro iniciado'),
  ('/dashboard/pm/equipe',         'Novo membro',              'button:has-text("Novo membro")',     'modal',    'critico', NULL),
  ('/dashboard/pm/comercial',      'Novo lead',                'button:has-text("Novo lead")',       'modal',    'normal',  NULL),
  ('/dashboard/pm/comercial',      'Nova proposta',            'button:has-text("Nova proposta")',   'modal',    'normal',  NULL),
  ('/dashboard/pm/comissao',       'Fechar previstas',         'button:has-text("Fechar previstas")','acao',     'normal',  'requer comissão prevista')
) AS v(rota, label, selector, tipo, prioridade, precond)
JOIN public.system_screens s ON s.rota = v.rota
WHERE NOT EXISTS (
  SELECT 1 FROM public.gold_screen_buttons gb WHERE gb.screen_id = s.id AND gb.botao_label = v.label
);
