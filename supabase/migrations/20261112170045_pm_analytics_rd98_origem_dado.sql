-- RD-98 p3 (origem do dado) — telas de analytics do P&M
-- Documenta no catálogo (system_screens) a ORIGEM DO DADO de três telas pm que o
-- auditor apontou com views_consumidas/rpcs_chamadas vazios — o único bloqueio do
-- selo nessas telas (RD-95/estado-vazio já OK no código). Aditiva, idempotente, só
-- metadado de catálogo (nenhum dado de cliente), sem RLS/permissão.
--
-- RD-38 (provado no dado, nunca suposto): a origem abaixo foi extraída do código vivo
-- das páginas (chamadas .rpc) e das definições vivas das funções (FROM/JOIN em
-- pg_get_functiondef). Objetos conferidos como existentes em public:
--   agency_clientes, agency_equipe, agency_integracao, agency_job_rodadas, agency_jobs,
--   agency_score_pesos, agency_servico, agency_timesheet, erp_receber.
-- fn_ajuda_campo_listar entra em rpcs_chamadas porque as três telas renderizam <AjudaCampo/> (RD-95).

-- /dashboard/pm/benchmark  ·  página chama fn_pm_benchmark
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_clientes','agency_equipe','agency_job_rodadas','agency_jobs','agency_servico','agency_timesheet'],
       rpcs_chamadas    = ARRAY['fn_pm_benchmark','fn_ajuda_campo_listar'],
       atualizado_em    = now()
 WHERE rota = '/dashboard/pm/benchmark';

-- /dashboard/pm/health-score  ·  página chama fn_agency_score_calcular/_pesos_get/_pesos_salvar
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_clientes','agency_jobs','agency_score_pesos','agency_timesheet','erp_receber'],
       rpcs_chamadas    = ARRAY['fn_agency_score_calcular','fn_agency_score_pesos_get','fn_agency_score_pesos_salvar','fn_ajuda_campo_listar'],
       atualizado_em    = now()
 WHERE rota = '/dashboard/pm/health-score';

-- /dashboard/pm/integracoes  ·  página chama fn_agency_integracao_listar/_conectar/_desconectar
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_integracao'],
       rpcs_chamadas    = ARRAY['fn_agency_integracao_listar','fn_agency_integracao_conectar','fn_agency_integracao_desconectar','fn_ajuda_campo_listar'],
       atualizado_em    = now()
 WHERE rota = '/dashboard/pm/integracoes';
