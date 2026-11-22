-- RD-98 p3 (origem do dado): classifica /dashboard/bpo/admin/contratos ("Contratos" — BPO Admin),
-- que estava em system_screens com views_consumidas/rpcs_chamadas vazios e
-- estado_real='desconhecida'. Registra as fontes reais e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- grants, segredo/vault nem cálculo. Fontes apenas REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/bpo/admin/contratos/page.tsx: from bpo_contratos ;
--     componente @/components/bpo/AdminGuard: from bpo_companies_assignment.
-- As tabelas bpo_contratos e bpo_companies_assignment existem em public
-- (conferido em pg_class: relkind 'r').
UPDATE public.system_screens
SET views_consumidas = ARRAY['bpo_contratos','bpo_companies_assignment']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/admin/contratos'
  AND estado_real = 'desconhecida';
