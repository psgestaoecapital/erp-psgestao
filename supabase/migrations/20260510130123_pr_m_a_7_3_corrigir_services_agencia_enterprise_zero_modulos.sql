-- ═══════════════════════════════════════════════════════════════
-- PR M.A.7.3: Corrigir bug de planos services com 0 modulos
-- ═══════════════════════════════════════════════════════════════
-- Autor: Claude (Engenheiro Chefe Senior)
-- Data: 10/05/2026 sessao 6 | Marco M.A.7
--
-- BUG DETECTADO em PR M.A.7.3 auditoria:
-- - v15_services_agencia: 0 modulos vinculados
-- - v15_services_enterprise: 0 modulos vinculados
-- (outros 3 services tem 30 modulos cada)
--
-- RISCO JURIDICO: vender plano sem nenhum modulo = entrega zero.
-- Risco CDC + risco reputacional.
--
-- ESCOPO LIMITADO (RD-25 respeitada):
-- - Replicar EXATAMENTE os 30 modulos de v15_services_pro
-- - NAO criar matriz tier nova (decisao comercial pendente)
-- - NAO mudar precos, descricoes, posicionamento
-- - APENAS preencher gap tecnico
--
-- DECISAO COMERCIAL MAIOR (pendente CEO):
-- - Diferenciar agencia vs pro (modulos extras? limites maiores?)
-- - Diferenciar enterprise vs pro (SLA? suporte?)
-- - Esses sao M.A.7.3 COMPLETO (futura sessao com CEO presente)
--
-- IDEMPOTENTE: ON CONFLICT (plan_id, module_id) DO NOTHING
-- ═══════════════════════════════════════════════════════════════

-- Replicar v15_services_pro -> v15_services_agencia
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, legacy)
SELECT
  'v15_services_agencia',
  pm.module_id,
  pm.is_default_active,
  false
FROM plan_modules pm
WHERE pm.plan_id = 'v15_services_pro'
ON CONFLICT (plan_id, module_id) DO NOTHING;

-- Replicar v15_services_pro -> v15_services_enterprise
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, legacy)
SELECT
  'v15_services_enterprise',
  pm.module_id,
  pm.is_default_active,
  false
FROM plan_modules pm
WHERE pm.plan_id = 'v15_services_pro'
ON CONFLICT (plan_id, module_id) DO NOTHING;
