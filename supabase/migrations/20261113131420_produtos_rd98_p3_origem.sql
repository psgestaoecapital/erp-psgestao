-- Produtividade · RD-98 p3 (origem do dado) para a tela Produtos (árvore de desmontagem),
-- rota /dashboard/produtividade/produtos. Code: jordana-code.
--
-- RD-38 (provado no dado): em system_screens a rota tinha views_consumidas = NULL e
-- rpcs_chamadas = {fn_prod_produto_colar} — só 1 dos 5 RPCs e nenhuma tabela/view. O auditor
-- PDCA aponta esse vazio como RD-98 pilar 3 (ORIGEM) incompleto ("0 views / 1 rpc"). Esta
-- migration só DOCUMENTA a origem real do dado, lida do código-fonte da própria página
-- (src/app/dashboard/produtividade/produtos/page.tsx) — nenhum comportamento muda, nenhuma
-- função é recriada.
--
-- Aditiva/idempotente: apenas UPDATE de uma linha de metadados (system_screens). Sem DDL, sem
-- dado de cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o auditor.
--
-- Fontes de leitura (from): industrial_plants (plantas da empresa) e prod_produto (cadastro).
-- RPCs: salvar (f1), arquivar, listar estrutura/árvore, colar lista em lote e importar do
-- sistema vinculado (atak).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['industrial_plants','prod_produto']::text[],
       rpcs_chamadas     = ARRAY['fn_prod_produto_f1_salvar','fn_prod_produto_arquivar',
                                 'fn_prod_estrutura_listar','fn_prod_produto_colar',
                                 'fn_prod_atak_produtos']::text[]
 WHERE rota = '/dashboard/produtividade/produtos';
