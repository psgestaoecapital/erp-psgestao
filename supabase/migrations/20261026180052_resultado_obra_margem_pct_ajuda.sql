-- Hub · Resultado por obra: ajuda "?" (RD-95) do novo indicador Margem % (margem / receita).
-- Aditiva: apenas insere uma linha de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.margem_pct',
   '/dashboard/projetos/obras/resultado',
   'Colunas',
   'Margem %',
   'Nada a preencher: é a margem dividida pela receita realizada, em porcentagem.',
   'Mostra quanto sobra de cada real recebido na obra, para comparar obras de tamanhos diferentes.',
   '12,5%',
   'Ler como margem sobre o custo: aqui é sobre a receita. Fica em branco enquanto a obra não tiver receita.',
   'projetos',
   221,
   1,
   'publicado')
ON CONFLICT (chave) DO NOTHING;
