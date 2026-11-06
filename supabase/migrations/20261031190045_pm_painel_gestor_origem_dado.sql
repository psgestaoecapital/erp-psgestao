-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/painel-gestor. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/painel-gestor/page.tsx (+ libs pm/painel, pm/painelGestor).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_timesheet']::text[],
    rpcs_chamadas = ARRAY['fn_usuarios_da_empresa']::text[]
WHERE rota = '/dashboard/pm/painel-gestor';
