-- PM · Eventos & Produções (/dashboard/pm/eventos) — PDCA aud8 02/11 (92/95).
-- RD-95: cria os textos de ajuda dos filtros de período "De" e "Até" (gap do auditor: os dois "?"
-- apontavam para pm.eventos.filtro_status em vez de chaves próprias). Aditiva e idempotente
-- (ON CONFLICT DO NOTHING): só insere chaves novas, não altera texto existente.
-- Prova RD-38: SELECT antes mostrava 0 linhas para essas duas chaves; depois, 2 linhas.
-- Code: desenvolvedor_4_g.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
  ('pm.eventos.filtro_de', 'Eventos · Filtros', 'De',
   'Data inicial do período. Mostra só os eventos cujo início é nessa data ou depois dela. Deixe em branco para não limitar o começo.',
   'Recortar a agenda a partir de uma data — ver o que vem de hoje em diante, ou o que aconteceu de um mês para cá.',
   'Colocar 01/11/2026 para ver os eventos a partir de novembro.',
   'Inverter com o "Até" (pôr uma data maior em "De") e a lista vir vazia: a data de "De" tem de ser menor ou igual à de "Até".',
   7, '/dashboard/pm/eventos'),
  ('pm.eventos.filtro_ate', 'Eventos · Filtros', 'Até',
   'Data final do período. Mostra só os eventos cujo início é nessa data ou antes dela. Deixe em branco para não limitar o fim.',
   'Fechar a agenda em uma data — ver só o que acontece até certo dia, sem o que vem depois.',
   'Colocar 30/11/2026 para ver os eventos só até o fim de novembro.',
   'Esquecer o "Até" preenchido de uma consulta anterior e achar que sumiram eventos futuros: limpe o campo para ver todos.',
   8, '/dashboard/pm/eventos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
