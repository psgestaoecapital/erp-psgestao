-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela /dashboard/pm/aprovacao.
-- Listas do grep .from()/.rpc() de page.tsx. Aditivo, idempotente, só metadado.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_clientes']::text[],
    rpcs_chamadas = ARRAY['fn_pm_job_mover_status']::text[]
WHERE rota = '/dashboard/pm/aprovacao';
