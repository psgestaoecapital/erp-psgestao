-- RD-98 p3 (origem do dado) · /dashboard/bpo (BPO Painel Principal)
-- Gap do auditor aud8 (82/95, item 4): system_screens.views_consumidas E rpcs_chamadas
-- nulos para a rota, apesar de a tela ler dado real.
--
-- Origem real lida de src/app/dashboard/bpo/page.tsx: a tela consome as tabelas
-- users, companies, user_companies, omie_imports, bpo_classificacoes e NÃO chama RPC.
-- Registramos a provenência (tabelas em views_consumidas, convenção já usada em
-- outras rotas; rpcs_chamadas = vazio pois a tela não usa RPC).
--
-- Aditiva/idempotente: só grava se houver diferença. Não toca dado de cliente.
-- Fora do escopo desta PR (núcleo financeiro / decisão de menu): rótulos "Sem nome",
-- seed sujo e o mapeamento de módulo colidente — ver tarefa do auditor.

UPDATE system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','omie_imports','bpo_classificacoes']::text[],
    rpcs_chamadas    = ARRAY[]::text[]
WHERE rota = '/dashboard/bpo'
  AND (
    views_consumidas IS DISTINCT FROM ARRAY['users','companies','user_companies','omie_imports','bpo_classificacoes']::text[]
    OR rpcs_chamadas IS DISTINCT FROM ARRAY[]::text[]
  );
