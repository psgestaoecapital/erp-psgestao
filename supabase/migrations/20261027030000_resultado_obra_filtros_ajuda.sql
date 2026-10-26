-- Hub · Resultado por obra: "?" (RD-95) da busca, do filtro de situação e do aviso "sem receita lançada".
-- Aditiva: só insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.busca', '/dashboard/projetos/obras/resultado', 'Filtros', 'Buscar obra',
   'Digite parte do número ou do nome da obra.', 'Reduz a lista (e o consolidado) às obras que você quer comparar.',
   'DEMO-FC', 'Esperar que a busca olhe o cliente: ela olha só número e nome da obra.', 'projetos', 222, 1, 'publicado'),
  ('projetos.resultado_obra.filtro_situacao', '/dashboard/projetos/obras/resultado', 'Filtros', 'Situação da obra',
   'Escolha todas, em andamento ou concluídas.', 'Mostra o resultado só das obras na situação escolhida; o consolidado acompanha o filtro.',
   'Em andamento', 'Achar que obra concluída some do sistema: ela só sai desta lista quando filtrada.', 'projetos', 223, 1, 'publicado'),
  ('projetos.resultado_obra.sem_receita', '/dashboard/projetos/obras/resultado', 'Indicadores', 'Sem receita lançada',
   'Nada a preencher: o aviso aparece quando a obra tem custo mas ainda nenhuma medição ou venda de material.',
   'Explica por que a margem aparece em branco: a receita só entra com medição aprovada ou pedido de material.',
   'Obra com R$ 4.458 de custo e nenhuma medição', 'Ler o R$ 0 como erro de cálculo: é receita ainda não lançada, o custo já é real.', 'projetos', 224, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
