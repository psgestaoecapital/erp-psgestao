-- Painel Comercial v6 (storytelling) — bloco 3: aba "Vendedores" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) dos blocos da aba Vendedores e das próprias abas (navegação).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_visao', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Visão geral', 'comercial', 10, 'publicado',
   'Navegação — não se preenche.',
   'Mostra o retrato do período: faturamento, volume, preço, faturamento por dia, as linhas de produto e o ritmo da semana.',
   'Comece por aqui para entender como a empresa vendeu no período.',
   'Procurar detalhe por vendedor nesta aba — isso fica na aba Vendedores.'),
  ('comv6.aba_vendedores', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Vendedores', 'comercial', 11, 'publicado',
   'Navegação — não se preenche.',
   'Compara os vendedores: quanto cada um vende, com que preço, desconto e devolução, e o que cada um vende.',
   'Abra para ver o placar da equipe e quem puxa o faturamento.',
   'O vendedor logado vê só os próprios números — o comparativo é do gestor.'),
  ('comv6.vend_quanto', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quem vende quanto', 'comercial', 12, 'publicado',
   'Indicador calculado — não se preenche.',
   'Ranking de faturamento por vendedor, com a participação de cada um no total e quantos clientes atende.',
   'Na Frioeste o 1º vendedor fatura ~R$ 3,37 mi (24% do total) atendendo 110 clientes.',
   'Achar que mais clientes = mais faturamento: um vendedor com poucos clientes grandes pode faturar mais.'),
  ('comv6.vend_placar', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Placar dos vendedores', 'comercial', 13, 'publicado',
   'Indicador calculado — não se preenche.',
   'Quadro por vendedor com faturamento, R$/kg (▲ acima / ▼ abaixo da média da empresa), desconto e devolução — para ver quem vende caro e limpo.',
   'Vender a R$ 38/kg com 1% de desconto e sem devolução é melhor que R$ 25/kg com 4% de desconto.',
   'Olhar só o faturamento: um volume alto com preço baixo e muito desconto rende margem pior.'),
  ('comv6.vend_desc_dev', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Desconto × devolução', 'comercial', 14, 'publicado',
   'Indicador calculado — não se preenche.',
   'Mostra, por vendedor, quanto saiu em desconto (abaixo da tabela) e quanto voltou em devolução, em reais, no período.',
   'Um vendedor com R$ 70 mil de desconto e devolução alta merece conversa sobre política de preço.',
   'Somar desconto com devolução: são coisas diferentes — um é preço, o outro é produto que voltou.'),
  ('comv6.vend_mix', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'O que cada um vende', 'comercial', 15, 'publicado',
   'Indicador calculado — não se preenche.',
   'A composição do faturamento de cada vendedor por tipo de produto (desossado, com osso, miúdo, outros).',
   'Um vendedor muito concentrado em desossado corre risco se o preço dessa linha cair.',
   'Confundir volume com faturamento: o mix aqui é por reais vendidos, não por peso.')
ON CONFLICT (chave) DO NOTHING;
