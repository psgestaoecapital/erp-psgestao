-- RD-98 p3 (origem do dado): classifica /dashboard/bpo/admin/empresas ("Empresas" — BPO Admin),
-- que estava em system_screens com views_consumidas/rpcs_chamadas vazios e
-- estado_real='desconhecida'. Registra as fontes reais e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- grants, segredo/vault nem cálculo. Fontes apenas REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/bpo/admin/empresas/page.tsx: from v_bpo_admin_painel ;
--     componente @/components/bpo/AdminGuard: from bpo_companies_assignment ;
--     @/components/bpo/AssignmentBadge (sem fonte de dado própria).
-- A view v_bpo_admin_painel e a tabela bpo_companies_assignment existem em public
-- (conferido em pg_class: relkind 'v' e 'r').
UPDATE public.system_screens
SET views_consumidas = ARRAY['v_bpo_admin_painel','bpo_companies_assignment']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/admin/empresas'
  AND estado_real = 'desconhecida';
