-- Painel Comercial v6 (storytelling) — bloco 6: aba "Produtos" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba Produtos. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_produtos', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Produtos', 'comercial', 40, 'publicado',
   'Navegação — não se preenche.',
   'Mostra todos os produtos vendidos e onde o preço do mesmo corte varia mais (onde o controle de preço escapa).',
   'Abra para achar o produto campeão e os cortes com preço bagunçado.',
   'Procurar linha de produto aqui — a visão por linha fica na aba Visão geral.'),
  ('comv6.prod_todos', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Todos os produtos', 'comercial', 41, 'publicado',
   'Indicador calculado — não se preenche.',
   'A lista completa de produtos com faturamento, volume, R$/kg e participação; use a busca para achar um corte.',
   'Na Frioeste são 127 produtos; o coxão mole resfriado lidera (~R$ 1,11 mi).',
   'Comparar R$/kg de carne com o de despojo: o despojo é barato por natureza e não serve de parâmetro.'),
  ('comv6.prod_busca', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Buscar produto', 'comercial', 42, 'publicado',
   'Digite parte do nome do produto para filtrar a lista.',
   'Encontra rápido um corte específico sem rolar toda a lista.',
   'Digitar "coxão" para ver os cortes de coxão.',
   'Escrever diferente do cadastro — a busca é por trecho do nome do produto.'),
  ('comv6.prod_preco_cai', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Onde o preço cai', 'comercial', 43, 'publicado',
   'Indicador calculado — não se preenche.',
   'Produtos (carne, com amostra mínima) em que o mesmo corte foi vendido a preços bem diferentes no período: mostra o preço mínimo, médio e máximo por kg e a variação.',
   'Um corte vendido de R$ 22 a R$ 34/kg tem variação alta — vale padronizar o preço mínimo.',
   'Confundir variação natural (cliente/volume) com descontrole: olhe junto com o cliente e o vendedor.')
ON CONFLICT (chave) DO NOTHING;
