-- AUDITORIA GOLD FASE 1 · cron hierárquico (4 jobs)
-- Aplicado via MCP apply_migration 25/05/2026 ~20:00 BRT
--
-- Substitui o cron único 'insight-auditor-4x-dia' ('0 */6 * * *')
-- por 4 jobs com schedule adequado à prioridade da tela:
--
--   • CRITICA    · 2x/dia (06h e 18h)       · Sonnet
--   • ALTA       · 1x/dia (12h)             · Haiku
--   • MEDIA      · 3x/semana (Seg/Qua/Sex)  · Haiku
--   • BAIXA      · 1x/semana (Domingo)      · Haiku
--
-- Cada job chama fn_disparar_insight_auditor_prioridade(prioridade, limit).

SELECT cron.unschedule('insight-auditor-4x-dia');

SELECT cron.schedule(
  'insight-auditor-critica-2x-dia',
  '0 6,18 * * *',
  $$SELECT public.fn_disparar_insight_auditor_prioridade('critica', 15);$$
);

SELECT cron.schedule(
  'insight-auditor-alta-1x-dia',
  '0 12 * * *',
  $$SELECT public.fn_disparar_insight_auditor_prioridade('alta', 15);$$
);

SELECT cron.schedule(
  'insight-auditor-media-3x-semana',
  '0 9 * * 1,3,5',
  $$SELECT public.fn_disparar_insight_auditor_prioridade('media', 15);$$
);

SELECT cron.schedule(
  'insight-auditor-baixa-1x-semana',
  '0 9 * * 0',
  $$SELECT public.fn_disparar_insight_auditor_prioridade('baixa', 9);$$
);
