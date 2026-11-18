-- RD-98 p3 (origem do dado) — dashboard_core: classificar estado_real e registrar a origem
-- do dado (views/tabelas lidas + RPCs) de 3 telas que estavam 'desconhecida' com 0 fontes.
--
-- Fontes PROVADAS no código (RD-38, leitura de src/app/dashboard/<rota>/page.tsx):
--   /dashboard/dados        → supabase.from: users, companies, company_groups, user_companies, omie_imports
--   /dashboard/visao-mensal → supabase.from: users, companies, company_groups, user_companies, omie_imports,
--                              business_lines, orcamento, v_lancamentos_consolidado
--   /dashboard/classico     → supabase.from: users, companies, company_groups, user_companies, erp_receber, erp_pagar
--                              supabase.rpc: fn_dashboard_kpis
--
-- Apenas METADADO de system_screens. Não toca RLS, dado de cliente nem comportamento.
-- ADITIVA e IDEMPOTENTE: só classifica quando ainda 'desconhecida' e só preenche a origem
-- quando ainda vazia — re-rodar não altera nada já preenchido por outro processo.

-- /dashboard/dados
UPDATE public.system_screens
SET estado_real = 'pronto'
WHERE rota = '/dashboard/dados' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','company_groups','user_companies','omie_imports']::text[]
WHERE rota = '/dashboard/dados'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/visao-mensal
UPDATE public.system_screens
SET estado_real = 'pronto'
WHERE rota = '/dashboard/visao-mensal' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','company_groups','user_companies','omie_imports','business_lines','orcamento','v_lancamentos_consolidado']::text[]
WHERE rota = '/dashboard/visao-mensal'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/classico
UPDATE public.system_screens
SET estado_real = 'pronto'
WHERE rota = '/dashboard/classico' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','company_groups','user_companies','erp_receber','erp_pagar']::text[]
WHERE rota = '/dashboard/classico'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_dashboard_kpis']::text[]
WHERE rota = '/dashboard/classico'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
