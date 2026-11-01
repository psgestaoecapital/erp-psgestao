-- Hub · Viagens: ajuda "?" (RD-95) de dois itens novos na tela /dashboard/projetos/viagens
-- que fecham gaps apontados pelo auditor PDCA (26/10):
--   1) "Composição do custo" — detalhamento do custo da viagem por categoria (combustível,
--      pedágio, diárias, outras despesas), dando transparência de COMO o valor é formado;
--   2) "Total da lista" — indicação de quantas viagens existem (exibidas × total), gap de
--      "não fica claro se há mais viagens além das exibidas".
-- Aditiva: apenas insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.viagem.composicao_custo',
   '/dashboard/projetos/viagens',
   'Acerto',
   'Composição do custo',
   'Nada a preencher: soma os lançamentos da viagem agrupados por categoria (combustível, pedágio, diárias e demais despesas).',
   'Mostra DE ONDE vem o valor total da viagem — quanto foi combustível, pedágio, diárias etc. — dando transparência sobre como o custo é formado antes de lançar no GE.',
   'Combustível R$ 540,00 · Pedágio R$ 128,00 · Diárias R$ 316,00 = Total R$ 984,00',
   'Estranhar o Total: ele é a soma das categorias abaixo; se um cupom ficou sem categoria, ele aparece em "Sem categoria".',
   'projetos',
   260,
   1,
   'publicado'),
  ('projetos.viagem.total_lista',
   '/dashboard/projetos/viagens',
   'Lista',
   'Total de viagens',
   'Nada a preencher: mostra quantas viagens estão sendo exibidas e quantas existem ao todo (após os filtros).',
   'Deixa claro se a lista está completa ou se há mais viagens além das visíveis, evitando a dúvida de "só tem essas?".',
   '3 de 12 viagens',
   'Confundir com viagens abertas: este contador é o total da lista; o selo "aberta(s)" no topo conta só as em aberto.',
   'projetos',
   261,
   1,
   'publicado')
ON CONFLICT (chave) DO NOTHING;
