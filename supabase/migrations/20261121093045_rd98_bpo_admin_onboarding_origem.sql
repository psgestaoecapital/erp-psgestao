-- RD-98 p3 (origem do dado): classifica /dashboard/bpo/admin/onboarding ("Onboarding" — BPO Admin),
-- que estava em system_screens com views_consumidas/rpcs_chamadas vazios e
-- estado_real='desconhecida'. Registra as fontes reais e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- grants, segredo/vault nem cálculo. Fontes apenas REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/bpo/admin/onboarding/page.tsx:
--     rpc fn_bpo_admin_listar_usuarios_disponiveis, fn_bpo_admin_onboarding_cliente (via @/lib/authFetch) ;
--   componente @/components/bpo/AdminGuard: from bpo_companies_assignment.
-- As 2 RPCs existem em public (pg_proc); bpo_companies_assignment é tabela (pg_class).
UPDATE public.system_screens
SET views_consumidas = ARRAY['bpo_companies_assignment']::text[],
    rpcs_chamadas = ARRAY['fn_bpo_admin_listar_usuarios_disponiveis','fn_bpo_admin_onboarding_cliente']::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/admin/onboarding'
  AND estado_real = 'desconhecida';
