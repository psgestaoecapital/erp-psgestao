-- "?" (RD-95) da busca/filtro do Cockpit (lista de obras com indicadores). Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.cockpit.busca_obra', 'Cockpit', 'Buscar obra',
 'Digite parte do número ou do nome da obra.',
 'Encurta a lista quando a empresa tem muitas obras.', 'Piso frigorífico', 'Digitar o nome do cliente: a busca olha só número e nome da obra.', 105, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.filtro_status', 'Cockpit', 'Filtrar por situação',
 'Escolha a situação das obras que quer ver: em andamento, concluída, pausada ou cancelada.',
 'Esconde obras encerradas e foca no que está rodando.', 'Em andamento', 'Achar que o filtro muda a situação da obra: ele só filtra a lista.', 106, '/dashboard/projetos/cockpit', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
