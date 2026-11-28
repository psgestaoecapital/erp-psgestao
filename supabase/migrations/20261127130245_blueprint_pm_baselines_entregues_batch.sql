-- Reconciliação de baseline em lote (RD-38: PROMETIDO vs REAL) — 3 requisitos ESSENCIAIS do P&M
-- que estavam 'parcial' no blueprint mas JÁ estão entregues na main. Provado por leitura de código:
--
--   tela 6 (Contratos) "Atalho filtrado dos contratos recorrentes da GE"
--     → src/app/dashboard/pm/contratos/page.tsx: lê erp_contratos (GE, fonte única do fee) e
--       agency_contratos (estende via erp_contrato_id); a tela É a visão filtrada dos contratos
--       recorrentes da GE no P&M (fn_agency_contrato_listar + erp_contratos).
--
--   tela 12 (Apontamento de Horas) "Registrar horas por job"
--     → src/app/dashboard/pm/apontamento-horas/page.tsx: cronômetro no job + lançamento manual →
--       agency_timesheet, com seleção de job (jobSel) e cálculo custo_total = horas × custo/hora.
--
--   tela 14 (Portfolio) "Entregas publicadas por cliente"
--     → src/app/dashboard/pm/portfolio/page.tsx: galeria de agency_jobs com status publicado/concluida,
--       filtrável por cliente (agency_clientes), com capa real da entrega.
--
-- Migration só corrige o registro de verdade (blueprint_tela_requisito, catálogo interno de
-- requisitos). NÃO toca código, dado de cliente, RLS, grants nem funções. Aditiva e idempotente
-- (cada UPDATE guarda id fixo + status_baseline='parcial'; re-rodar não muda nada).

UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/contratos · lê erp_contratos (GE) + agency_contratos (erp_contrato_id); visão filtrada dos contratos/fees recorrentes da GE. Reconciliação RD-38.'
 WHERE id='3d25a7fd-0727-44ed-a201-6ca0bd6ce320' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/apontamento-horas · cronômetro no job + manual → agency_timesheet, com seleção de job. Reconciliação RD-38.'
 WHERE id='17e5de7d-6554-4ecc-8a44-2c8f8db56720' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/portfolio · galeria de agency_jobs publicado/concluida, filtrável por cliente, com capa real. Reconciliação RD-38.'
 WHERE id='e8044dad-d2ae-4031-b8f2-fde87dbb27ea' AND status_baseline='parcial';
