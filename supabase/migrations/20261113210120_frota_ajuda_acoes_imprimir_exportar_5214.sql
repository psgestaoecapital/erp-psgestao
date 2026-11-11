-- RD-95 (CEO 08/10): "?" em TODA ação da tela. A tela de Relatórios da Frota (#5214,
-- /dashboard/projetos/frota) já tem "?" nos filtros, mas as DUAS ações do rodapé — "Imprimir"
-- e "Exportar CSV" — estavam sem ajuda. Esta migration é ADITIVA e IDEMPOTENTE: só insere as
-- duas chaves de ajuda que faltam, no mesmo padrão do seed 20261028130100 (hub_frota_relatorios).
-- Nenhum dado de cliente é tocado. Prova RD-38 no corpo da PR (SELECT das 8 chaves depois).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.frota.rel_imprimir', '/dashboard/projetos/frota', 'Relatórios', 'Imprimir',
   'Abre a janela de impressão com o relatório que está na tela (tabela e gráfico).', 'Gera uma via em papel ou PDF do que você está vendo, já com os filtros aplicados.', 'Imprimir o consumo de outubro para arquivar.', 'Imprimir antes de escolher o período certo: a impressão sai com o que está na tela agora.', 'hub', 966, 1, 'publicado'),
  ('projetos.frota.rel_exportar', '/dashboard/projetos/frota', 'Relatórios', 'Exportar CSV',
   'Baixa os números da tabela atual em um arquivo CSV (abre no Excel ou Google Planilhas).', 'Leva os dados do relatório para a planilha, para somar, cruzar ou guardar.', 'Exportar a rodagem por motorista do mês.', 'Exportar sem dados na tela: o botão fica disponível só quando há resultado.', 'hub', 967, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
