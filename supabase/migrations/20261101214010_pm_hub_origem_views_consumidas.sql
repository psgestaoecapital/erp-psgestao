-- RD-98 p3 (origem do dado) · Hub P&M (/dashboard/pm)
--
-- Contexto (auditor_pdca_2, 31/10): a tela do Hub/BI da P&M tinha
-- system_screens.views_consumidas VAZIO, embora as 3 RPCs de BI leiam
-- varias fontes. rpcs_chamadas ja estava preenchido
-- (fn_pm_bi_kpis, fn_pm_bi_series, fn_pm_bi_indicadores); faltava a
-- origem das tabelas/fontes lidas por essas RPCs.
--
-- Prova no dado (RD-38) antes desta migration:
--   views_consumidas = NULL  (n_views = 0)
--   rpcs_chamadas    = {fn_pm_bi_kpis, fn_pm_bi_indicadores, fn_pm_bi_series}
--
-- NOTA (RD-38): o bug de contagem reportado na mesma auditoria
-- (agency_jobs sem "AND excluido_em IS NULL") JA ESTAVA corrigido nas
-- 3 funcoes vivas (pg_get_functiondef) no momento desta migration:
--   fn_pm_bi_kpis.jobs_andamento -> filtra excluido_em IS NULL (DEMO = 60)
--   fn_pm_bi_series.jobs_atrasados / margem (JOIN agency_jobs) -> idem
--   fn_pm_bi_indicadores.jobs_entregues / jobs_prazo -> idem
-- Por isso esta migration NAO reescreve as funcoes (evita churn/regressao);
-- fecha apenas o gap de origem do dado (RD-98 p3).
--
-- Aditiva e idempotente: so preenche quando ainda esta vazio.
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
     'erp_contratos',
     'agency_clientes',
     'agency_jobs',
     'agency_timesheet',
     'agency_comissao',
     'erp_receber',
     'area_indicadores_mestres'
   ]::text[]
 WHERE rota = '/dashboard/pm'
   AND COALESCE(array_length(views_consumidas, 1), 0) = 0;
