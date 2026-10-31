-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/briefings. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/briefings/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_briefings','agency_clientes','agency_contratos','agency_jobs']::text[],
    rpcs_chamadas = ARRAY['fn_pm_planejamento_do_fee']::text[]
WHERE rota = '/dashboard/pm/briefings';
