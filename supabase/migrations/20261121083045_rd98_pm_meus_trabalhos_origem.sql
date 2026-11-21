-- RD-98 p3 (origem do dado): classifica /dashboard/pm/meus-trabalhos ("Meus trabalhos" — P&M),
-- que estava em system_screens com views_consumidas/rpcs_chamadas vazios e
-- estado_real='desconhecida'. Registra as fontes reais e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- grants, segredo/vault nem cálculo. Fontes apenas REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/pm/meus-trabalhos/page.tsx: rpc fn_pauta_listar, fn_pauta_contadores ;
--     from agency_jobs, agency_tarefas ; componentes AjudaCampo, pm/BotaoPlay,
--     pm/EmpresaNaoResolvida (sem fontes de dado próprias).
-- As 2 RPCs e as 2 relações existem em public (conferido em pg_proc/pg_class).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_tarefas']::text[],
    rpcs_chamadas = ARRAY['fn_pauta_listar','fn_pauta_contadores']::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/pm/meus-trabalhos'
  AND estado_real = 'desconhecida';
