-- Hub · Resultado por obra: ajuda "?" (RD-95) da busca e do filtro de situação. Aditiva: só referência em erp_ajuda_campo.
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.busca','/dashboard/projetos/obras/resultado','Filtros','Buscar obra',
   'Digite parte do número ou do nome da obra.','Reduz a tabela e o consolidado às obras que combinam com o texto.','FC-001 ou piso','Esperar que a busca altere o dado: ela só filtra o que está na tela.','projetos',222,1,'publicado'),
  ('projetos.resultado_obra.filtro_status','/dashboard/projetos/obras/resultado','Filtros','Situação da obra',
   'Escolha uma situação (ex.: em andamento) ou deixe em "Todas as situações".','Mostra e soma só as obras daquela situação.','em_andamento','Esquecer o filtro ligado e achar que faltam obras: o consolidado soma só as visíveis.','projetos',223,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
