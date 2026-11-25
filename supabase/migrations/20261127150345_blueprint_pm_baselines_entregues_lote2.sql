-- Reconciliação de baseline em lote 2 (RD-38: PROMETIDO vs REAL) — 6 requisitos ESSENCIAIS do P&M
-- que estavam 'parcial' no blueprint mas JÁ estão entregues na main. Provado por leitura de código:
--
--   tela 1 (Hub BI) "Alertas operacionais"
--     → src/app/dashboard/pm/page.tsx Faixa 4 — Alertas: jobs atrasados, contratos a renovar (60d) e
--       títulos vencidos (serie.alertas), cada um com "?" (RD-95) e link para a tela de origem.
--
--   tela 5 (Catálogo de Serviços) "Entregáveis do serviço"
--     → src/app/dashboard/pm/servicos/page.tsx: campo entregaveis[] no form, gravado em
--       fn_agency_servico_salvar e exibido na lista ("Entregáveis: ...").
--
--   tela 7 (Comercial) "Visão comercial consolidada (pipeline/conversão)"
--     → src/app/dashboard/pm/comercial/page.tsx: funil configurável por empresa (fn_funil_etapas_listar)
--       com contagem por etapa + taxa de conversão (win-rate das propostas decididas).
--
--   tela 103 (Contratado × Realizado) "Por cliente e item do contrato: contratado, realizado, saldo, % e status"
--     → src/app/dashboard/pm/contratado-realizado/page.tsx: fn_pm_contratado_realizado devolve
--       contratado, realizado, saldo, pct e status (ok/atencao/estourado) com selo por linha.
--
--   tela 106 (Health Score) "Score 0-100 = prazo 30% + margem 30% + pagamento 20% + atividade 20%"
--   tela 106 (Health Score) "Pesos EDITÁVEIS por empresa (soma 100%), 4 componentes + dados insuficientes"
--     → src/app/dashboard/pm/health-score/page.tsx: pesos editáveis (agency_score_pesos,
--       fn_agency_score_pesos_get/_salvar; padrão 30/30/20/20, soma 100) + ranking com os 4 componentes
--       e "dados insuficientes" (fn_agency_score_calcular).
--
-- Migration só corrige o registro de verdade (blueprint_tela_requisito, catálogo interno). NÃO toca
-- código, dado de cliente, RLS, grants nem funções. Aditiva e idempotente (cada UPDATE guarda id fixo
-- + status_baseline='parcial').

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm · Faixa 4 Alertas (jobs atrasados, contratos a renovar 60d, títulos vencidos) com "?". RD-38.'
 WHERE id='fee74615-5ab9-4f44-804b-c1ad911b0c23' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/servicos · entregaveis[] no form/salvar/lista (fn_agency_servico_salvar). RD-38.'
 WHERE id='dbb60f34-9371-42da-9139-67d839277c43' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/comercial · funil configurável (fn_funil_etapas_listar) + taxa de conversão (win-rate). RD-38.'
 WHERE id='0edfa649-bcf2-473e-a82e-d62cc45b9a91' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/contratado-realizado · fn_pm_contratado_realizado: contratado, realizado, saldo, pct, status (ok/atencao/estourado) com selo. RD-38.'
 WHERE id='c4867f20-92ff-425d-aacf-ae526c75f7af' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/health-score · score = prazo 30 + margem 30 + pagamento 20 + atividade 20 (fn_agency_score_calcular). RD-38.'
 WHERE id='34a90b3e-1a3f-4aaf-88bc-afc426aeec36' AND status_baseline='parcial';

UPDATE public.blueprint_tela_requisito SET status_baseline='atendido',
       evidencia_baseline='main · /dashboard/pm/health-score · pesos editáveis por empresa (agency_score_pesos, soma 100), 4 componentes por cliente + "dados insuficientes". RD-38.'
 WHERE id='96afe10e-e513-44f3-a4c6-0b222bc31ff7' AND status_baseline='parcial';
