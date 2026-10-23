-- Hub · tela Insumos pronta (RD-95): "?" nos filtros, nas ações do topo e no "Atualizar preço". Os campos da gaveta
-- de cadastro já vieram no #3025 (projetos.insumos.form.*). Só INSERT de texto de ajuda; idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.insumos.importar', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 20, 'Importar biblioteca',
   'Nada a preencher: copia para a sua empresa os insumos do catálogo público da PS.', 'Dá um ponto de partida com materiais comuns de obra; depois você ajusta custo e nome.',
   'Importar e depois atualizar o preço dos 20 materiais que mais usa', 'Importar e não revisar os preços — o custo dos serviços fica com valor de referência.'),
  ('projetos.insumos.novo', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 21, 'Novo insumo',
   'Nada a preencher: abre a gaveta para cadastrar um material ou equipamento.', 'O insumo cadastrado pode ser usado na composição de qualquer serviço do catálogo.',
   'Cadastrar a placa de gesso que você compra', 'Cadastrar de novo um insumo que já existe — busque antes.'),
  ('projetos.insumos.busca', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 22, 'Buscar',
   'Digite parte do nome, do código ou do fornecedor.', 'Só filtra a lista. Não muda nenhum valor.',
   'placa', 'Esquecer um filtro de Categoria/Status ligado e achar que o insumo sumiu.'),
  ('projetos.insumos.filtro_categoria', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 23, 'Categoria',
   'Escolha uma categoria para ver só esses insumos, ou Todas.', 'Só filtra a lista.',
   'Gesso e drywall', 'Deixar filtrado e não encontrar um material de outra categoria.'),
  ('projetos.insumos.filtro_status', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 24, 'Status',
   'Ativos, Inativos ou Todos.', 'Só filtra a lista. Inativos não aparecem para novos serviços.',
   'Inativos, para reativar um material', 'Procurar um insumo inativo com o filtro em Ativos.'),
  ('projetos.insumos.filtro_origem', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 25, 'Origem',
   'Manual (você criou) ou Biblioteca (veio do catálogo público), ou Todas.', 'Só filtra a lista. Ajuda a revisar o que foi importado.',
   'Biblioteca, para revisar preços importados', 'Achar que Biblioteca é de outra empresa — são cópias suas, editáveis.'),
  ('projetos.insumos.preco_novo', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 26, 'Novo preço (R$)',
   'Quanto você pagou por UMA unidade do insumo na última compra.', 'Vira o custo atual do insumo e recalcula o custo dos serviços que o usam.',
   'R$ 41,50 por placa', 'Lançar o valor total da nota em vez do preço por unidade.'),
  ('projetos.insumos.preco_data', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 27, 'Data da compra',
   'O dia da compra que gerou esse preço.', 'Fica no histórico de preços, para ver a variação no tempo.',
   '20/10/2026', 'Deixar a data de hoje para uma compra antiga — o histórico fica fora de ordem.')
ON CONFLICT (chave) DO NOTHING;
