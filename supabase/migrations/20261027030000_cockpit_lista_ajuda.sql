-- "?" (RD-95) da lista do Cockpit (cards com avanço/custo/margem, busca e filtro). Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.cockpit.busca', 'Cockpit', 'Buscar obra',
 'Digite parte do número ou do nome da obra.', 'Filtra os cards na hora, sem recarregar.', 'DEMO-FC', 'Digitar o nome do cliente: a busca olha número e nome da obra.', 150, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.filtro_situacao', 'Cockpit', 'Filtrar por situação',
 'Escolha a situação das obras que quer ver.', 'Separa obras em andamento das concluídas, pausadas ou canceladas.', 'Em andamento', 'Achar que "Todas" some com as canceladas: elas aparecem.', 160, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.card_avanco', 'Cockpit', 'Avanço da obra',
 'Nada a preencher: serviço medido dividido pelo contratado.', 'Mostra quanto da obra já foi medido e pode ser faturado.', '30%', 'Confundir com avanço físico do cronograma.', 170, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.card_custo', 'Cockpit', 'Custo realizado',
 'Nada a preencher: soma material, viagens, mão de obra e rateio lançados na obra.', 'Fica vermelho quando passa do custo previsto.', 'R$ 4.458,00', 'Esperar custo de obra sem lançamentos: ele fica zerado.', 180, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.card_margem', 'Cockpit', 'Margem da obra',
 'Nada a preencher: receita realizada menos custo realizado.', 'Mostra se a obra está dando lucro até agora.', 'R$ 12.000 (23%)', 'Ler margem negativa no começo: a medição pode ainda não ter sido lançada.', 190, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.card_pendencias', 'Cockpit', 'Pendências da obra',
 'Nada a preencher: conta alertas como obra sem orçamento, custo acima do previsto ou margem negativa.', 'Mostra onde olhar primeiro.', '2 pendências', 'Ignorar o selo vermelho: abra o cockpit para ver o motivo.', 200, '/dashboard/projetos/cockpit', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
