-- RD-98 p3 (ORIGEM DO DADO): /dashboard/pm/painel-jobs. Grep .from()/.rpc() de page.tsx. Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_clientes','agency_grupos_clientes','agency_campanhas','agency_servico','agency_job_rodadas','agency_timesheet','agency_painel_opcao']::text[],
    rpcs_chamadas = ARRAY['fn_usuarios_da_empresa']::text[]
WHERE rota = '/dashboard/pm/painel-jobs';
