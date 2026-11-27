-- HB0 (tela 30) · reconcilia baseline do essencial "tabelas largas no celular" — JÁ IMPLEMENTADO (RD-26/RD-52).
-- Requisito: "virar cards OU rolagem com coluna fixa". As 4 telas nomeadas atendem (RD-38, provado por leitura):
--   Desempenho  src/app/dashboard/projetos/desempenho/page.tsx:196  cards md:hidden + tabela hidden md:block com coluna fixa (sticky left:0)
--   Resultado   src/app/dashboard/projetos/obras/resultado/page.tsx:269 cards md:hidden (no-print) + tabela hidden md:block
--   Catálogo    src/app/dashboard/projetos/catalogo/page.tsx           layout em cards/grid Tailwind responsivo (sem <table> largo)
--   Mão de obra src/components/maoObra/MaoObraTela.tsx:231,274,303,361,1060,1097,1267  tabelas dentro de contêiner overflow-auto/overflow-x-auto ("HB0 · celular"): rolam no contêiner, não alargam a página
-- Code: desenvolvedor_4_g
-- Idempotente: UPDATE por chave natural (vertical, tela_num, requisito).

update public.blueprint_tela_requisito
   set status_baseline  = 'atendido',
       evidencia_baseline = 'PR #desenvolvedor_4_g · HB0 reconcile · Desempenho/Resultado=cards md:hidden; Catalogo=cards Tailwind; MaoObra=tabelas em overflow-auto (HB0 celular)'
 where vertical = 'hub_projetos'
   and tela_num = 30
   and requisito = 'CORRIGIR: tabelas mais largas que a tela no celular (Desempenho, Catálogo, Mão de obra, Resultado por obra) — virar cards ou rolagem com coluna fixa';
