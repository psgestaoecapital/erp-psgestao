-- Painel Comercial v6 (storytelling) — bloco 4: aba "Clientes" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba Clientes. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_clientes', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Clientes', 'comercial', 20, 'publicado',
   'Navegação — não se preenche.',
   'Mostra quem compra: segmentos, concentração, mix por cliente, tamanho das notas, grupos econômicos e saúde da carteira.',
   'Abra para entender a carteira e onde reativar cliente.',
   'Procurar número de vendedor aqui — isso fica na aba Vendedores.'),
  ('comv6.cli_segmentos', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Os clientes em 6 grupos', 'comercial', 21, 'publicado',
   'Indicador calculado — não se preenche.',
   'Agrupa os clientes por recência e frequência: Campeões, Fiéis, Novos, Ativos, Regulares e Adormecidos. Cada grupo traz nº de clientes e faturamento.',
   'Muitos "Adormecidos" com faturamento alto = carteira esfriando, hora de reativar.',
   'Tratar todo cliente igual: o campeão e o adormecido pedem abordagens diferentes.'),
  ('comv6.cli_concentracao', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quanto dependemos de poucos', 'comercial', 22, 'publicado',
   'Indicador calculado — não se preenche.',
   'Curva ABC: quantos clientes fazem 80% (classe A), 80–95% (B) e 95–100% (C) do faturamento.',
   'Na Frioeste ~134 clientes (28%) fazem 80% do faturamento — dependência alta de poucos.',
   'Ignorar a concentração: perder um cliente da classe A dói muito mais que perder um da C.'),
  ('comv6.cli_linhas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quem compra mais linhas gasta mais', 'comercial', 23, 'publicado',
   'Indicador calculado — não se preenche.',
   'Ticket médio por cliente conforme quantos tipos de produto (desossado/com osso/miúdo) ele leva — mostra o ganho de ampliar o mix.',
   'Cliente que leva 3 tipos gasta bem mais que quem leva 1 — vale oferecer o que falta.',
   'Olhar só o número de clientes: ampliar o mix de quem já compra costuma render mais que buscar cliente novo.'),
  ('comv6.cli_notas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Tamanho das notas', 'comercial', 24, 'publicado',
   'Indicador calculado — não se preenche.',
   'Distribuição das notas fiscais por valor — mostra se a empresa vive de muitas notas pequenas ou de poucas grandes.',
   'Muitas notas pequenas podem indicar custo de atendimento alto por real vendido.',
   'Confundir nota com cliente: um cliente pode ter várias notas no período.'),
  ('comv6.cli_grupos', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Grupos econômicos', 'comercial', 25, 'publicado',
   'Indicador calculado — não se preenche.',
   'Redes com mais de uma loja (mesmo CNPJ raiz), somando o que o grupo compra e em quantas lojas.',
   'Um grupo com 5 lojas pode ser seu maior "cliente" mesmo que cada loja compre pouco.',
   'Negociar loja a loja sem ver que todas são do mesmo dono — o poder de barganha é do grupo.'),
  ('comv6.cli_saude', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Saúde da carteira', 'comercial', 26, 'publicado',
   'Indicador calculado — não se preenche.',
   'Proporção da carteira que está ativa (comprou há pouco) frente aos clientes adormecidos (há tempo sem comprar).',
   'Carteira 70% ativa é saudável; muita gente adormecida pede uma ação de recuperação.',
   'Comemorar clientes novos sem olhar quantos pararam de comprar no mesmo período.')
ON CONFLICT (chave) DO NOTHING;
