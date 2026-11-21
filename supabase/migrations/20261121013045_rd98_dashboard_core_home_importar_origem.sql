-- RD-98 p3 (origem do dado) — dashboard_core: registra a origem do dado (views/tabelas
-- lidas + RPCs) de 2 telas de /dashboard que estavam com views_consumidas e
-- rpcs_chamadas vazios em system_screens, e classifica o estado_real quando ainda
-- 'desconhecida'.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem o comportamento das telas. ADITIVA e IDEMPOTENTE: só
-- classifica quando ainda 'desconhecida' e só preenche a origem quando ainda vazia —
-- re-rodar não altera nada já preenchido por outro processo.
--
-- Fontes PROVADAS no código (RD-38):
--   /dashboard/importar  → src/app/dashboard/importar/page.tsx lê, via supabase.from:
--                          users, companies, user_companies
--   /dashboard/home      → src/app/dashboard/home/page.tsx chama supabase.rpc('fn_grupo_empresa')
--                          e consome as rotas /api/dashboard/{home,universal,grupos,atalhos}:
--                            • /api/dashboard/home     → rpc fn_dashboard_home, fn_dashboard_home_periodo
--                            • /api/dashboard/universal → from: companies, dashboard_atalhos,
--                                 dashboard_atalhos_default, dashboard_grupos, dashboard_grupos_empresas,
--                                 erp_pagar, erp_receber, psgc_fluxo_realizado
--                            • /api/dashboard/grupos    → from: dashboard_grupos, dashboard_grupos_empresas,
--                                 user_companies
--                            • /api/dashboard/atalhos   → from: dashboard_atalhos, dashboard_atalhos_default
-- Existência conferida no banco (pg_proc / information_schema): todas as RPCs e tabelas acima existem.
-- Code: desenvolvedor_4_g

-- /dashboard/importar — Importar dados (lista de empresas conforme papel do usuário)
UPDATE public.system_screens
SET estado_real = 'pronto'
WHERE rota = '/dashboard/importar' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/importar'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/home — Painel inicial (KPIs do grupo/empresa por período)
UPDATE public.system_screens
SET views_consumidas = ARRAY['companies','user_companies','dashboard_grupos','dashboard_grupos_empresas','dashboard_atalhos','dashboard_atalhos_default','erp_pagar','erp_receber','psgc_fluxo_realizado']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/home'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_grupo_empresa','fn_dashboard_home','fn_dashboard_home_periodo']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/home'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
