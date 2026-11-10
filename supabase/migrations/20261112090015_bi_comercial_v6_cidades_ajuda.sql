-- Painel Comercial v6 (storytelling) — bloco 5: aba "Cidades" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba Cidades. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_cidades', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Cidades', 'comercial', 30, 'publicado',
   'Navegação — não se preenche.',
   'Mostra onde a empresa vende: as cidades que mais compram e a lista completa com busca.',
   'Abra para ver a concentração geográfica e onde há espaço para crescer.',
   'Confundir cidade do cliente com cidade de entrega — aqui é a praça do cliente.'),
  ('comv6.cid_onde', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Onde a Frioeste vende', 'comercial', 31, 'publicado',
   'Indicador calculado — não se preenche.',
   'As 10 cidades que mais faturam no período, com a participação de cada uma e o quanto as 10 juntas concentram.',
   'Na Frioeste Chapecó/SC lidera com ~R$ 2,74 mi entre 86 cidades.',
   'Achar que a venda é pulverizada: poucas cidades costumam puxar a maior parte.'),
  ('comv6.cid_todas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Todas as cidades', 'comercial', 32, 'publicado',
   'Indicador calculado — não se preenche.',
   'A lista completa de cidades com faturamento, clientes, R$/kg e nº de vendedores atuando; use a busca para achar uma praça.',
   'Uma cidade com muitos clientes e R$/kg baixo pode ser oportunidade de melhorar preço.',
   'Ler a lista inteira sem usar a busca quando procura uma cidade específica.'),
  ('comv6.cid_busca', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Buscar cidade', 'comercial', 33, 'publicado',
   'Digite parte do nome da cidade para filtrar a lista.',
   'Encontra rápido uma praça específica sem rolar toda a lista.',
   'Digitar "chapecó" para ver só Chapecó/SC.',
   'Esperar resultado com o nome escrito diferente do cadastro (a busca é por trecho do nome).')
ON CONFLICT (chave) DO NOTHING;
