-- HB0 (tela 30) · reconcilia baseline de 2 essenciais JÁ IMPLEMENTADOS no código (RD-26: não refazer; RD-52: arquivo+PR).
-- Marca status_baseline='atendido' com a evidência no código (RD-38: provado por leitura de arquivo, não suposto).
-- Code: desenvolvedor_4_g
--
-- Item 1 — "links '/dashboard' dentro do Hub mandam para a home da GE — devem voltar para o painel do Hub"
--   PROVA: nenhum href/push para a rota NUA "/dashboard" nas rotas do Hub.
--     grep -rEn "[\"'`]/dashboard[\"'`]" src/app/dashboard/projetos/ src/app/dashboard/hub/  => 0 ocorrências
--   Os links do Hub apontam todos para sub-rotas /dashboard/projetos/... (painel do Hub), nenhum para a home da GE.
--
-- Item 2 — "telas sem título identificável (Pedidos, Contador, OS, IBPT) — toda tela com título claro"
--   PROVA (cada tela tem <h1> visível):
--     /dashboard/pedidos        src/app/dashboard/pedidos/page.tsx:246   -> "Pedidos de Venda"
--     /dashboard/contador       src/app/dashboard/contador/page.tsx:283  -> "Módulo Contador"
--     /dashboard/os             src/app/dashboard/os/page.tsx:237        -> título da OS
--     /dashboard/dev/ibpt       src/app/dashboard/dev/ibpt/page.tsx:326  -> "Importar tabela IBPT (Lei 12.741)"
--
-- Idempotente: UPDATE por chave natural (vertical, tela_num, requisito); re-rodar não altera nada além do estado-alvo.

update public.blueprint_tela_requisito
   set status_baseline  = 'atendido',
       evidencia_baseline = 'PR #desenvolvedor_4_g · HB0 reconcile · sem href/push "/dashboard" nu nas rotas do Hub (home do Hub preservada em /dashboard/projetos/...)'
 where vertical = 'hub_projetos'
   and tela_num = 30
   and requisito = 'CORRIGIR: links "/dashboard" dentro do Hub mandam para a home da GE — devem voltar para o painel do Hub';

update public.blueprint_tela_requisito
   set status_baseline  = 'atendido',
       evidencia_baseline = 'PR #desenvolvedor_4_g · HB0 reconcile · <h1> em pedidos:246 (Pedidos de Venda), contador:283 (Módulo Contador), os:237, dev/ibpt:326 (Importar tabela IBPT)'
 where vertical = 'hub_projetos'
   and tela_num = 30
   and requisito = 'CORRIGIR: telas sem título identificável (Pedidos, Contador, OS, IBPT) — toda tela com título claro';
