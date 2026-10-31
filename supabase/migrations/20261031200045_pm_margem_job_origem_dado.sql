-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/margem-job. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/margem-job/page.tsx (+ lib pm/equipeCustos).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_contratos','agency_equipe','agency_jobs','agency_servico']::text[],
    rpcs_chamadas = ARRAY['fn_pm_job_custos','fn__mao_obra_pode_ver_individual','fn_pm_equipe_custos']::text[]
WHERE rota = '/dashboard/pm/margem-job';
