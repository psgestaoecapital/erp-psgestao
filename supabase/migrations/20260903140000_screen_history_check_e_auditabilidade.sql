-- Screen-watcher · telemetria que grava de verdade + auditabilidade visível.
--
-- (1) BUG DE VERACIDADE: o CHECK de system_screens_history.capture_status só aceitava valores em
--     INGLÊS ('success','error'...), mas a rota Playwright grava em PORTUGUÊS ('sucesso','erro').
--     Resultado: TODO insert do capturador Playwright violava o CHECK e era engolido em silêncio
--     (0 linhas de capture_method='playwright', sempre). A telemetria de captura existia no papel e
--     não gravava. Alinha o CHECK aos valores reais (mantém os do fetcher edge) + os novos estados
--     do #1240 ('rota_nao_alcancada','nao_carregou').
ALTER TABLE public.system_screens_history DROP CONSTRAINT IF EXISTS system_screens_history_capture_status_check;
ALTER TABLE public.system_screens_history ADD CONSTRAINT system_screens_history_capture_status_check
  CHECK (capture_status = ANY (ARRAY[
    -- fetcher edge (inglês, legado)
    'success','auth_failed','timeout','error','404',
    -- capturador Playwright (português) + estados de cobertura do #1240
    'sucesso','erro','rota_nao_alcancada','nao_carregou'
  ]::text[]));

-- (2) AUDITABILIDADE VISÍVEL (pedido do CEO): rota que o robô nunca alcança (módulo não habilitado
--     para a empresa do auditor) não pode ficar "em branco" no painel — tem que dizer "não auditável".
--     Colunas dedicadas (não reusa estado_real, que é maturidade de produto: parcial/pronto/...).
ALTER TABLE public.system_screens
  ADD COLUMN IF NOT EXISTS auditavel_robo boolean,          -- null=desconhecido, true=alcançável, false=não auditável pelo robô
  ADD COLUMN IF NOT EXISTS motivo_nao_auditavel text,       -- ex.: 'módulo não habilitado para o auditor (redirect para /dashboard)'
  ADD COLUMN IF NOT EXISTS auditabilidade_em timestamptz;
