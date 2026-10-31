-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.rpcs_chamadas da tela /dashboard/pm/importar-siga.
-- A importação da planilha roda pela RPC fn_pm_importar_jobs_siga (grep .rpc() de page.tsx); sem leitura de view.
-- Aditivo, idempotente, só metadado.
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_pm_importar_jobs_siga']::text[]
WHERE rota = '/dashboard/pm/importar-siga';
