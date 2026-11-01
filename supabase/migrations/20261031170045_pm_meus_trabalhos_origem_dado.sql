-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/meus-trabalhos. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/meus-trabalhos/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_tarefas']::text[],
    rpcs_chamadas = ARRAY['fn_pauta_listar','fn_pauta_contadores']::text[]
WHERE rota = '/dashboard/pm/meus-trabalhos';
