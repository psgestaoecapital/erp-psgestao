-- RD-98 p3 (origem do dado) — preenche system_screens.views_consumidas / rpcs_chamadas de 3 telas
-- utilitárias que estavam NULL (não-verificadas). Code: desenvolvedor_4_g.
--
-- MÉTODO (RD-38): grep de .from/.rpc/fetch nas páginas e nas rotas de API que elas consomem,
-- confirmado em pg_class. Array vazio = VERIFICADO sem fonte de dado (página estática / só localStorage),
-- distinto de NULL (não-verificado) — mesma convenção das telas já classificadas (#5635/#5636/#5637).
--
-- 1) /dashboard/ajuda (Centro de Ajuda): a página chama /api/ajuda/context e /api/ajuda/chat.
--    - /api/ajuda/context lê as tabelas 'empresas', 'assessorias', 'lancamentos'; porém SÓ 'assessorias'
--      existe (pg_class) — 'empresas' e 'lancamentos' são referências mortas (legadas) que falham no catch.
--      Registro só a fonte REAL consumida: assessorias.
--    - /api/ajuda/chat é só LLM (sem tabela/RPC). A página não chama RPC direta.
--    => views_consumidas = {assessorias}; rpcs_chamadas = {}.
-- 2) /dashboard/assessor (PS Assessor): hub de navegação 100% estático (cards + router.push),
--    sem .from/.rpc/fetch. => ambos vazios (verificado).
-- 3) /dashboard/tutorial (Tutorial): catálogo estático filtrado no cliente; persiste progresso só em
--    localStorage ('ps_tutorials_done'); import de supabase não é usado. => ambos vazios (verificado).
--
-- Aditiva/idempotente: só preenche onde está NULL (não sobrescreve classificação já feita).
-- Toca apenas metadados de catálogo global (system_screens), não dado de cliente, não RLS/permissão.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['assessorias']::text[],
       rpcs_chamadas    = ARRAY[]::text[]
 WHERE rota = '/dashboard/ajuda'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY[]::text[]
 WHERE rota = '/dashboard/assessor'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY[]::text[]
 WHERE rota = '/dashboard/tutorial'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;
