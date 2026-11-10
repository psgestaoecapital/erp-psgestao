-- Painel Comercial v6 (storytelling) — bloco 4: aba "Clientes" na rota /dashboard/comercial/meu-painel-v6.
-- Três seções novas, todas derivadas de modelo.clis (o motor v5 já classifica segmento, curva ABC e nº de linhas por
-- cliente) — front puro, sem RPC nova e sem tocar o v5 em /meu-painel:
--   1. "Os clientes em 6 grupos" — distribuição dos clientes por segmento (campeões, fiéis, novos, ocasionais,
--      em risco, sumindo), com quantidade e faturamento de cada grupo.
--   2. "Quanto dependemos de poucos" — curva ABC: quantos clientes (A) somam até 80% do faturamento e a fatia do
--      maior cliente.
--   3. "Quem compra mais linhas gasta mais" — ticket médio por faixa de nº de linhas de carne/miúdo compradas.
--
-- A ajuda "?" é carregada por ROTA (fn_ajuda_campo_listar filtra c.rota = p_rota); as chaves são do v6 (comv6.*) com a
-- rota do v6, dando continuidade às abas Visão geral e Vendedores.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.cli_grupos', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Os clientes em 6 grupos', 'comercial', 11, 'publicado',
   'Indicador calculado — não se preenche.',
   'Separa os clientes do período em seis grupos pela recência e frequência de compra (campeões, fiéis, novos, ocasionais, em risco e sumindo), mostrando quantos são e quanto faturam.',
   'Se "em risco" + "sumindo" concentram muito faturamento, há dinheiro em clientes esfriando — vale uma ação de retenção.',
   'Tratar todo cliente igual: um campeão e um sumindo precisam de abordagens diferentes.'),
  ('comv6.cli_concentracao', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quanto dependemos de poucos', 'comercial', 12, 'publicado',
   'Indicador calculado — não se preenche.',
   'Curva ABC da carteira: quantos clientes (A) somam até 80% do faturamento, quantos estão entre 80% e 95% (B) e quantos nos últimos 5% (C); mostra também a fatia do maior cliente.',
   'Se 20 clientes (A) fazem 80% do faturamento, perder um pesa muito — concentração alta é risco.',
   'Olhar só o número de clientes: o que importa é quanto do faturamento depende de poucos.'),
  ('comv6.cli_linhas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quem compra mais linhas gasta mais', 'comercial', 13, 'publicado',
   'Indicador calculado — não se preenche.',
   'Agrupa os clientes por quantas linhas de carne/miúdo compram (1, 2 ou 3) e mostra o ticket médio de cada faixa — evidencia a oportunidade de venda cruzada.',
   'Se quem leva 3 linhas tem ticket bem maior que quem leva 1, oferecer uma 2ª linha ao cliente de 1 linha tende a crescer a conta.',
   'Confundir ticket médio da faixa com faturamento total da faixa: faixas têm números de clientes diferentes.')
ON CONFLICT (chave) DO NOTHING;
