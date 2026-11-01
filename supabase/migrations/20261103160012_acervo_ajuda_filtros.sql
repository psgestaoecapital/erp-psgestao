-- Hub · Takeoff · Acervo de plantas (/dashboard/projetos/takeoff/acervo) — PDCA aud8 01/11 (85/75/85).
-- RD-95: textos de ajuda dos novos filtros por Projeto e por Cliente (gap do auditor: "filtro por tipo de
-- projeto/cliente"). Aditiva e idempotente (ON CONFLICT DO NOTHING): só insere chaves novas, não altera texto.
-- Code: dev7claudeps.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
  ('hub.takeoff.acervo.filtro_projeto', 'Acervo · Filtro', 'Projeto',
   'Escolha um projeto para ver só as plantas dele. A lista traz os projetos que aparecem nas plantas desta empresa.',
   'Encontra rápido as plantas de uma obra/projeto específico quando o acervo tem muitas plantas de projetos diferentes.',
   'Selecionar "Residencial Aurora" para ver só as plantas daquele projeto.',
   'Esquecer o filtro ligado e achar que sumiram plantas: volte para "Todos os projetos" para ver o acervo inteiro.',
   45, '/dashboard/projetos/takeoff/acervo'),
  ('hub.takeoff.acervo.filtro_cliente', 'Acervo · Filtro', 'Cliente',
   'Escolha um cliente para ver só as plantas dele. A lista traz os clientes que aparecem nas plantas desta empresa.',
   'Separa o acervo por cliente — útil para reunir tudo de um mesmo contratante antes de uma reunião ou proposta.',
   'Selecionar "Construtora Horizonte" para ver só as plantas daquele cliente.',
   'Deixar o filtro de cliente ligado junto com a busca e estranhar a lista curta: limpe os dois para ver todas.',
   46, '/dashboard/projetos/takeoff/acervo')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
