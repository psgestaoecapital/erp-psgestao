-- RD-98 p3 (origem do dado): classifica /dashboard/pm/meu-dia ("Meu dia" — P&M),
-- que estava em system_screens com views_consumidas/rpcs_chamadas vazios e
-- estado_real='desconhecida'. Registra as fontes reais (página + componentes) e classifica.
--
-- Só metadado de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- grants, segredo/vault nem cálculo. Fontes apenas REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo).
--
-- Fontes conferidas no código (RD-38):
--   src/app/dashboard/pm/meu-dia/page.tsx: rpc fn_usuarios_da_empresa, fn_pauta_listar,
--     fn_agency_anotacao_arquivar ; from agency_job_comentarios, agency_timesheet,
--     agency_pauta_lote, agency_anotacoes, agency_aprovacoes ; componente AjudaCampo.
--   componentes pm/BarraHorasHoje (agency_timesheet), pm/ResumoFimDia (agency_jobs,
--     agency_job_comentarios, agency_timesheet), pm/Cronometro (agency_jobs, agency_timesheet).
-- As 3 RPCs e as 6 relações existem em public (conferido em pg_proc/pg_class).
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'agency_job_comentarios','agency_timesheet','agency_pauta_lote',
      'agency_anotacoes','agency_aprovacoes','agency_jobs'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_usuarios_da_empresa','fn_pauta_listar','fn_agency_anotacao_arquivar'
    ]::text[],
    estado_real = 'parcial',
    atualizado_em = now()
WHERE rota = '/dashboard/pm/meu-dia'
  AND estado_real = 'desconhecida';
