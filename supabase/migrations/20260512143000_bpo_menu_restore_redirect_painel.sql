-- migrations/20260512143000_bpo_menu_restore_redirect_painel.sql
-- BPO Menu Restore: redirecionar rota do modulo "Painel Multi-Cliente" para a pagina existente.
-- Antes:  /dashboard/bpo/painel       (404 - pagina nunca criada)
-- Depois: /dashboard/bpo/supervisao   (pagina ja existe e implementa multi-empresa)
-- Os demais 5 modulos (classificacao, conciliacao, relatorios, sla, atribuicao) recebem
-- placeholders "em construcao" em codigo (page.tsx) — nao mexem em module_catalog.
-- Idempotente.

BEGIN;

UPDATE public.module_catalog
SET rota = '/dashboard/bpo/supervisao'
WHERE id = 'bpo_painel_multi_cliente'
  AND rota = '/dashboard/bpo/painel';

COMMIT;
