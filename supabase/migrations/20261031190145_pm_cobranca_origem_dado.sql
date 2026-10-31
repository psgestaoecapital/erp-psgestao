-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/cobranca. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/cobranca/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_contratos']::text[],
    rpcs_chamadas = ARRAY[]::text[]
WHERE rota = '/dashboard/pm/cobranca';
