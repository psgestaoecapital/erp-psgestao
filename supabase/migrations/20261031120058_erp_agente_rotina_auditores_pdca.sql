-- erp_agente_rotina · + auditor_pdca_1 (Gmail) e auditor_pdca_2 (Yahoo) na allowlist, ALINHANDO o CHECK à produção.
-- Contexto (AGENTS.md): o CHECK vinha divergindo por ganhar agentes FORA de migration (dev7claudeps, aud8claudeps,
-- code-desenvolvedor-3, desenvolvedor_4/5/6_g, auditor_pdca_g), o que fazia o banco de testes recusar essas linhas
-- (23503) — "volta quando uma migration alinhar o CHECK à produção". Esta migration passa o CHECK COMPLETO para o
-- ledger (superconjunto: mantém todos os atuais + os 2 novos), destravando o banco de testes.
-- Aditiva/segura: a allowlist só cresce; os INSERTs são ON CONFLICT DO NOTHING.
-- Auditores PDCA de jornada: loop contínuo até telas >= 95; roteiam pela menor fila; aciona=false (acordam pelo
-- agendamento do Claude Code). A vertical de cada um fica no TEXTO da rotina.

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
CHECK (agente = ANY (ARRAY[
  'gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria',
  'gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code',
  'teste-despertador','gilberto-esteira','gilberto-revisor','eng-chefe-auto',
  'code-desenvolvedor-3','desenvolvedor_4_g','desenvolvedor_5_g','desenvolvedor_6_g',
  'auditor_pdca_g','dev7claudeps','aud8claudeps',
  'auditor_pdca_1','auditor_pdca_2'
]::text[]));

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('auditor_pdca_1', false, 'Auditor PDCA de jornada — conta Gmail. Vertical no TEXTO da rotina (hoje: Hub). Loop contínuo até telas >=95; roteia pela menor fila.'),
  ('auditor_pdca_2', false, 'Auditor PDCA de jornada — conta Yahoo. Vertical no TEXTO da rotina (hoje: P&M). Loop contínuo até telas >=95; roteia pela menor fila.')
ON CONFLICT (agente) DO NOTHING;
