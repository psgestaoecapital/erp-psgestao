-- Hub · Resultado por obra: "?" (RD-95) do custo fixo rateado e do contador de obras. Aditiva: só referência em erp_ajuda_campo.
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.rateio','/dashboard/projetos/obras/resultado','Indicadores','Custo fixo rateado',
   'Não se preenche: vem do rateio dos custos fixos da empresa entre as obras.','Parte do custo fixo (aluguel, administração) atribuída a esta obra. Entra no Custo e, portanto, reduz a margem: Custo = materiais + viagens + mão de obra + rateio.','R$ 1.200,00 de rateio sobre uma obra de R$ 40.000,00','Achar que o Custo não fecha com Materiais + Viagens + Mão de obra: falta somar o rateio.','projetos',224,1,'publicado'),
  ('projetos.resultado_obra.contagem','/dashboard/projetos/obras/resultado','Indicadores','Obras na lista',
   'Não se preenche: conta as obras exibidas e o total existente.','Mostra quantas obras estão somadas no consolidado em relação ao total da empresa.','3 de 12 obras','Esquecer um filtro ligado e achar que o consolidado cobre todas as obras.','projetos',225,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
