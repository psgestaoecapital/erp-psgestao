INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.resultado_obra.busca','Resultado por obra','Buscar obra','Digite parte do número ou do nome da obra.','Acha a obra rápido e recalcula o consolidado só com as obras exibidas.','FC-001','Digitar valores: a busca é só por texto.',400,'/dashboard/projetos/obras/resultado','projetos','publicado'),
('projetos.resultado_obra.filtro_situacao','Resultado por obra','Filtrar por situação','Escolha uma situação para ver só essas obras.','Separa obras em andamento das concluídas; o consolidado acompanha o filtro.','Em andamento','Deixar filtrado e achar que a obra sumiu.',410,'/dashboard/projetos/obras/resultado','projetos','publicado')
ON CONFLICT (chave) DO NOTHING;
