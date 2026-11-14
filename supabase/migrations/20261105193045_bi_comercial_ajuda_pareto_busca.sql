-- BI Comercial · Pareto MOSTRA TUDO (CEO): a lista de concentração deixa de cortar em top-N e passa a exibir
-- TODOS os rótulos (cliente/vendedor/supervisor/filial) com busca, ordenação maior↔menor e rolagem interna.
-- RD-95: o filtro de busca da lista tem o "?" (AjudaCampo), com a chave existente no banco. Aqui cadastro o texto
-- de ajuda do filtro de busca do Pareto. Aditivo e idempotente (WHERE NOT EXISTS), catálogo de ajuda global,
-- sem dado de cliente. Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  (
    'comercial.bi.pareto_busca',
    '/dashboard/inteligencia/comercial',
    'Concentração (Pareto)',
    'Buscar na concentração',
    'Digite parte do nome do cliente, vendedor, supervisor ou filial para filtrar a lista de concentração. A lista mostra TODOS os itens do período (nada é cortado); a busca só ajuda a localizar um nome específico.',
    'Permite achar depressa um cliente ou vendedor dentro da lista completa, sem rolar tudo. A posição (rank) e o % acumulado continuam sendo os da lista inteira, ordenada do maior para o menor.',
    'Digitar "frigo" mostra só os rótulos que contêm "frigo", mantendo a posição real de cada um na concentração.',
    'Esperar que a busca mude os totais ou o ranking: ela só filtra a exibição — o cálculo continua sobre o período inteiro.',
    'comercial',
    30,
    'publicado'
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave
);
