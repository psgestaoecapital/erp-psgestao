-- EHS · EPI Estoque: ajuda RD-95 das ações novas "Inativar/Reativar" item e do filtro "Mostrar inativos".
-- RD-98 p2: a linha de estoque passa a ter inativação rastreável (soft-delete via coluna `ativo`, já existente)
--           além de "Editar mínimo". Nenhuma linha de estoque é apagada; o registro e o saldo ficam guardados.
-- Aditiva e idempotente: só INSERE 2 chaves de ajuda novas (ON CONFLICT DO NOTHING). Não cria/altera tabela,
-- função, RLS, grant nem dado de cliente. erp_ajuda_campo tem UNIQUE (chave) -> ON CONFLICT (chave) válido.
-- Prova RD-38 (read-only, antes): as 2 chaves NÃO existiam (0 linhas) -> a migration não duplica nada (0 -> 1 cada).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('compliance.epi.estoque.inativar', '/dashboard/ehs/epi/estoque', 'Ações', 'Inativar / Reativar item',
   'Nada a preencher: use "Inativar" para tirar da lista um item de estoque que não é mais usado (EPI descontinuado ou linha criada por engano). O saldo e o histórico ficam guardados; o item some do dia a dia. "Reativar" traz o item de volta.',
   'Mantém a lista de estoque limpa sem apagar o registro: o item inativado sai das entradas e entregas, mas pode ser reativado quando voltar a ser usado.',
   'A luva CA 12345 foi substituída por outro modelo: inative a linha para ela não aparecer mais nas entradas e entregas.',
   'Inativar um item que ainda está em circulação: confirme que o EPI não é mais usado antes de inativar.',
   'compliance', 95, 1, 'publicado'),
  ('compliance.epi.estoque.mostrar_inativos', '/dashboard/ehs/epi/estoque', 'Filtros', 'Mostrar inativos',
   'Nada a preencher: marque para ver também os itens de estoque inativados e poder reativá-los.',
   'Por padrão a lista mostra só os itens ativos. Ligue este filtro para revisar ou reativar itens que foram inativados.',
   'Marque "Mostrar inativos" para reativar uma luva que voltou a ser usada.',
   'Esquecer de desmarcar: a lista continua exibindo os itens inativados junto com os ativos.',
   'compliance', 96, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
