-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/apontamento-horas. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/apontamento-horas/page.tsx (+ lib pm/equipeCustos).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_equipe','agency_jobs','agency_timesheet']::text[],
    rpcs_chamadas = ARRAY['fn_pm_timesheet_apontar','fn_pm_timesheet_custos','fn__mao_obra_pode_ver_individual','fn_pm_equipe_custos']::text[]
WHERE rota = '/dashboard/pm/apontamento-horas';
