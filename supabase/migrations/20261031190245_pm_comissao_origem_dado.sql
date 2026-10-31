-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/comissao. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/comissao/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_comissao','agency_jobs']::text[],
    rpcs_chamadas = ARRAY['fn_agency_comissao_aprovar']::text[]
WHERE rota = '/dashboard/pm/comissao';
