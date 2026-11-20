-- RD-98 p3 (origem do dado) — preenche system_screens.views_consumidas / rpcs_chamadas
-- de /dashboard/noc (NOC — monitoramento operacional), que estava NULL (não-verificada).
-- Code: desenvolvedor_4_g.
--
-- MÉTODO (RD-38): a página chama a rota de API /api/noc; grep de .from/.rpc em
-- src/app/api/noc/route.ts e confirmação em pg_class (2026-11-20).
-- Fontes REAIS consumidas (15 tabelas/views confirmadas em public):
--   ai_reports, bpo_classificacoes, bpo_execucoes, companies, erp_alerta_proativo,
--   erp_credencial, financiamentos, omie_imports, orcamento, user_companies, users,
--   v_ia_saude, v_ia_saude_endpoints, wealth_assets, wealth_clients.
-- A referência .from('plano_acao') é MORTA (a tabela não existe em nenhum schema;
-- a query devolve null no catch) — não entra, igual ao tratamento das refs legadas
-- do #5658. Não há .rpc na rota → rpcs_chamadas vazio (verificado).
--
-- Aditiva/idempotente: só preenche onde está NULL (não sobrescreve classificação já feita).
-- Toca apenas metadados de catálogo global (system_screens); NÃO altera as tabelas,
-- RLS/permissão nem dado de cliente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'ai_reports',
         'bpo_classificacoes',
         'bpo_execucoes',
         'companies',
         'erp_alerta_proativo',
         'erp_credencial',
         'financiamentos',
         'omie_imports',
         'orcamento',
         'user_companies',
         'users',
         'v_ia_saude',
         'v_ia_saude_endpoints',
         'wealth_assets',
         'wealth_clients'
       ]::text[],
       rpcs_chamadas    = ARRAY[]::text[]
 WHERE rota = '/dashboard/noc'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;
