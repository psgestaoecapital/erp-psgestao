-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.rpcs_chamadas da tela /dashboard/pm (painel BI).
-- A tela consome os dados exclusivamente pelas 3 RPCs de BI (grep .rpc() de src/app/dashboard/pm/page.tsx);
-- não lê view/tabela direto. Aditivo: só metadado, idempotente, filtrado pela rota.
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_pm_bi_kpis','fn_pm_bi_indicadores','fn_pm_bi_series']::text[]
WHERE rota = '/dashboard/pm';
