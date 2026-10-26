-- Hub · Cockpit (lista): ajuda "?" (RD-95) da busca e do filtro de situação. Aditiva: só linhas de referência.
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.cockpit.busca','/dashboard/projetos/cockpit','Lista','Buscar obra','Digite parte do código ou do nome da obra; a lista filtra enquanto você digita.','Achar a obra rápido quando houver muitas, sem rolar a tela.','Digitar "piso" mostra só as obras com piso no nome.','Digitar o código completo com hífen diferente do cadastro; use só um trecho.','projetos',270,1,'publicado'),
  ('projetos.cockpit.filtro_situacao','/dashboard/projetos/cockpit','Lista','Filtro por situação','Escolha Todas, Em andamento, Concluída, Pausada ou Cancelada.','Enxuga a lista para a situação que interessa, sem alterar nada na obra.','Em andamento mostra só as obras ativas.','Achar que a obra sumiu: confira se o filtro está em Todas as situações.','projetos',271,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
