-- P&M · Onda P5.-1 — habilitar o Gold a enxergar a vertical pm ANTES de construir P5.0+.
-- Espelha a Revenda (RD-26): carrega a RÉGUA (blueprint_tela_requisito, vertical='pm') que o juiz
-- mede, e marca as 7 CASCAS como não-auditáveis para o robô nunca medir placeholder como tela pronta
-- (fecha a dívida do V5 §3.4 / contexto 57ad78c4).
--
-- Provado no dado (25/09), NÃO adivinhado (RD-38):
--   * gold_screen_buttons pm: 21 botões em 11 rotas reais — a camada de clique JÁ existe.
--   * blueprint_tela_requisito pm: 0 (Revenda: 124) — a régua estava vazia. ESTE é o gap.
--   * 7 cascas (benchmark, bot, eventos, health-score, ia-preco, ia-preditiva, integracoes):
--     estado_real='placeholder' e 0 botões, mas auditavel_robo=NULL. Fixamos =false + motivo.
--   * Assinatura da sandbox NÃO é necessária: o robô screenshot@ é system_role=PS_ADMIN, isento do
--     gating (vide cabeçalho de 20260918190000_pm_gold_bot_agencia_seed.sql). Não mexemos em planos.
--
-- Baseline honesto (RD-38): status_baseline reflete o que o código faz HOJE —
--   atendido = provado funcionando · parcial = existe mas incompleto · ausente = não existe.
-- Sem função SECURITY DEFINER nesta migration (nenhum guard de fn envolvido).

BEGIN;

-- ── 1) RÉGUA da pm ────────────────────────────────────────────────────────────
-- UNIQUE(vertical, tela_num, requisito) garante idempotência.
INSERT INTO public.blueprint_tela_requisito
  (vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
VALUES
  -- Tela 1 · Hub P&M (BI)
  ('pm', 1, 'Hub P&M (BI)', '/dashboard/pm', 'KPIs: MRR, clientes, jobs, horas, comissão, a receber', 'kpi', 'essencial', 'parcial'),
  ('pm', 1, 'Hub P&M (BI)', '/dashboard/pm', 'Indicadores de moat (MRA, OTDR, RHT, HSC)', 'bloco', 'essencial', 'ausente'),
  ('pm', 1, 'Hub P&M (BI)', '/dashboard/pm', 'Gráficos e séries (fn_pm_bi_series)', 'bloco', 'essencial', 'atendido'),
  ('pm', 1, 'Hub P&M (BI)', '/dashboard/pm', 'Alertas operacionais', 'bloco', 'diferencial', 'parcial'),
  ('pm', 1, 'Hub P&M (BI)', '/dashboard/pm', 'Paleta PS (espresso/off-white/dourado)', 'visual', 'essencial', 'atendido'),

  -- Tela 2 · Leads / CRM
  ('pm', 2, 'Leads / CRM', '/dashboard/pm/leads', 'Kanban de leads com etapas configuráveis', 'bloco', 'essencial', 'atendido'),
  ('pm', 2, 'Leads / CRM', '/dashboard/pm/leads', 'Criar lead (fn_agency_lead_criar)', 'regra', 'essencial', 'atendido'),
  ('pm', 2, 'Leads / CRM', '/dashboard/pm/leads', 'Mover etapa por arraste', 'regra', 'essencial', 'atendido'),
  ('pm', 2, 'Leads / CRM', '/dashboard/pm/leads', 'Ganhar lead cria cliente + proposta (fn_agency_lead_ganhar)', 'regra', 'essencial', 'atendido'),
  ('pm', 2, 'Leads / CRM', '/dashboard/pm/leads', 'Filtro por período e por responsável', 'campo', 'diferencial', 'ausente'),

  -- Tela 3 · Agenda
  ('pm', 3, 'Agenda', '/dashboard/pm/agenda', 'Reuniões da agência (origem_modulo=pm)', 'bloco', 'essencial', 'atendido'),
  ('pm', 3, 'Agenda', '/dashboard/pm/agenda', 'Vincular reunião a um lead', 'campo', 'diferencial', 'parcial'),

  -- Tela 4 · Propostas
  ('pm', 4, 'Propostas', '/dashboard/pm/propostas', 'CRUD de proposta + itens', 'bloco', 'essencial', 'atendido'),
  ('pm', 4, 'Propostas', '/dashboard/pm/propostas', 'Total sempre recalculado dos itens (sem proposta R$0)', 'regra', 'essencial', 'parcial'),
  ('pm', 4, 'Propostas', '/dashboard/pm/propostas', 'Aprovar proposta (fn_agency_proposta_aprovar)', 'regra', 'essencial', 'atendido'),
  ('pm', 4, 'Propostas', '/dashboard/pm/propostas', 'Enviar ao cliente (PDF/link/aceite) — P2', 'regra', 'essencial', 'ausente'),
  ('pm', 4, 'Propostas', '/dashboard/pm/propostas', 'Periodicidade e horas estimadas por item (base p/ P6/P7)', 'campo', 'essencial', 'ausente'),

  -- Tela 5 · Catálogo de Serviços
  ('pm', 5, 'Catálogo de Serviços', '/dashboard/pm/servicos', 'Serviço recorrente/pontual/pacote', 'bloco', 'essencial', 'atendido'),
  ('pm', 5, 'Catálogo de Serviços', '/dashboard/pm/servicos', 'Valor base + horas estimadas', 'campo', 'essencial', 'parcial'),
  ('pm', 5, 'Catálogo de Serviços', '/dashboard/pm/servicos', 'Entregáveis do serviço', 'campo', 'diferencial', 'parcial'),
  ('pm', 5, 'Catálogo de Serviços', '/dashboard/pm/servicos', 'Template de etapas por serviço — P5.1', 'bloco', 'diferencial', 'ausente'),

  -- Tela 6 · Contratos
  ('pm', 6, 'Contratos', '/dashboard/pm/contratos', 'Atalho filtrado dos contratos recorrentes da GE', 'bloco', 'essencial', 'parcial'),
  ('pm', 6, 'Contratos', '/dashboard/pm/contratos', 'Escopo quantificado (agency_contrato_itens) — P5.0', 'bloco', 'essencial', 'ausente'),
  ('pm', 6, 'Contratos', '/dashboard/pm/contratos', 'Relatório contratado × realizado — P6', 'kpi', 'diferencial', 'ausente'),

  -- Tela 7 · Comercial
  ('pm', 7, 'Comercial', '/dashboard/pm/comercial', 'Visão comercial consolidada (pipeline/conversão)', 'bloco', 'essencial', 'parcial'),

  -- Tela 8 · Comissão
  ('pm', 8, 'Comissão', '/dashboard/pm/comissao', 'Aprovar comissão (fn_agency_comissao_aprovar)', 'regra', 'essencial', 'atendido'),
  ('pm', 8, 'Comissão', '/dashboard/pm/comissao', 'Comissão por papel (comercial/gestor do fee) — P8', 'regra', 'diferencial', 'ausente'),

  -- Tela 9 · Briefings
  ('pm', 9, 'Briefings', '/dashboard/pm/briefings', 'Criar briefing', 'bloco', 'essencial', 'atendido'),
  ('pm', 9, 'Briefings', '/dashboard/pm/briefings', 'Transformar briefing em job', 'regra', 'essencial', 'atendido'),

  -- Tela 10 · Workspace / Produção
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Kanban de jobs (5 estágios)', 'bloco', 'essencial', 'atendido'),
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Mover job de estágio (fn_pm_job_mover_status)', 'regra', 'essencial', 'atendido'),
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Criar job pela tela', 'regra', 'essencial', 'atendido'),
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Job nasce do contrato/escopo — P5.0', 'regra', 'essencial', 'ausente'),
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Tarefas/subetapas do job (agency_tarefas) — P5.2', 'bloco', 'essencial', 'ausente'),
  ('pm', 10, 'Workspace / Produção', '/dashboard/producao', 'Comissão lançada em Contas a Pagar da GE (não só preview)', 'regra', 'diferencial', 'ausente'),

  -- Tela 11 · Aprovação Cliente
  ('pm', 11, 'Aprovação Cliente', '/dashboard/pm/aprovacao', 'Aprovar job por link do cliente (trilha LGPD)', 'regra', 'essencial', 'ausente'),

  -- Tela 12 · Apontamento de Horas
  ('pm', 12, 'Apontamento de Horas', '/dashboard/pm/apontamento-horas', 'Registrar horas por job', 'bloco', 'essencial', 'parcial'),
  ('pm', 12, 'Apontamento de Horas', '/dashboard/pm/apontamento-horas', 'Tempo por ETAPA (etapa_tipo) — P5.3', 'campo', 'essencial', 'ausente'),
  ('pm', 12, 'Apontamento de Horas', '/dashboard/pm/apontamento-horas', 'Cronômetro liga/desliga por etapa e cliente — P6', 'regra', 'essencial', 'ausente'),

  -- Tela 13 · Margem por Job
  ('pm', 13, 'Margem por Job', '/dashboard/pm/margem-job', 'Margem = receita − (tempo×custo-hora + diretos + indiretas)', 'kpi', 'essencial', 'ausente'),
  ('pm', 13, 'Margem por Job', '/dashboard/pm/margem-job', 'Rentabilidade por cliente e por serviço — P7', 'kpi', 'diferencial', 'ausente'),

  -- Tela 14 · Portfolio
  ('pm', 14, 'Portfolio', '/dashboard/pm/portfolio', 'Entregas publicadas por cliente', 'bloco', 'essencial', 'parcial'),

  -- Tela 15 · Equipe
  ('pm', 15, 'Equipe', '/dashboard/pm/equipe', 'Cadastro de equipe com custo-hora (agency_equipe)', 'bloco', 'essencial', 'atendido'),

  -- Tela 16 · Cobrança por Etapa
  ('pm', 16, 'Cobrança por Etapa', '/dashboard/pm/cobranca', 'Cobrança vinculada à etapa/entrega', 'bloco', 'essencial', 'parcial'),

  -- Tela 17 · Configurações
  ('pm', 17, 'Configurações', '/dashboard/pm/configuracoes', 'Funil configurável (add/editar/excluir etapas)', 'regra', 'essencial', 'atendido'),
  ('pm', 17, 'Configurações', '/dashboard/pm/configuracoes', 'Config de medição por etapa e cliente (agency_etapa_medicao_config) — P6', 'regra', 'essencial', 'ausente')
ON CONFLICT (vertical, tela_num, requisito) DO NOTHING;

-- ── 2) Marcar as 7 CASCAS como não-auditáveis (não medir placeholder como pronto) ──
UPDATE public.system_screens
SET auditavel_robo = false,
    motivo_nao_auditavel = 'Casca/placeholder: sem feature real e 0 botões Gold. Não medir como tela pronta (dívida V5 §3.4 / contexto 57ad78c4). Reavaliar quando a onda que a constrói entrar.',
    auditabilidade_em = now()
WHERE area = 'pm'
  AND estado_real = 'placeholder'
  AND auditavel_robo IS DISTINCT FROM false;

COMMIT;
