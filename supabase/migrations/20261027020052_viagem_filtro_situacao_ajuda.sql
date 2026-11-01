-- Hub · Viagens: ajuda "?" (RD-95) de dois itens novos na tela /dashboard/projetos/viagens
-- que fecham gaps apontados pela auditoria FC (26/10, aud8claudeps):
--   1) "Fechamento administrativo" — selo que explica o fluxo da tela (o administrativo abre a
--      viagem, lança os cupons e fecha), hoje sem "?" (RD-95 exige "?" em TODO item visível);
--   2) "Situação" — novo filtro da lista por status da viagem (Aberta/Fechada), gap "sem filtro
--      por situação" apontado pela auditoria.
-- Aditiva: apenas insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.viagem.fechamento_administrativo',
   '/dashboard/projetos/viagens',
   'Lista',
   'Fechamento administrativo',
   'Nada a preencher: é um aviso de como a tela funciona. O administrativo abre a viagem, lança cada cupom (despesa ou abastecimento, cada um com a sua obra), confere adiantamento × gastos × saldo e fecha.',
   'Deixa claro que esta tela faz o acerto de viagens NOVAS pelo fluxo administrativo: ao fechar, a viagem gera os títulos no GE (Resultado da obra) com o custo rateado por obra.',
   'Abrir viagem → lançar cupons com a obra de cada um → conferir o saldo → Fechar viagem → Lançar no GE.',
   'Esperar que viagens antigas (fora do sistema) apareçam aqui: a tela trata apenas as viagens abertas pelo próprio fechamento administrativo.',
   'projetos',
   262,
   1,
   'publicado'),
  ('projetos.viagem.filtro_situacao',
   '/dashboard/projetos/viagens',
   'Lista',
   'Filtro por situação',
   'Escolha a situação para enxugar a lista: Todas, Aberta (ainda em acerto) ou Fechada (acerto concluído). Filtra apenas o que já veio do banco, sem alterar nada.',
   'Ajuda a achar rápido o que você quer conferir — por exemplo, só as viagens Abertas que ainda faltam fechar, ou só as Fechadas para revisar o que já foi lançado no GE.',
   'Situação = Aberta → a lista mostra só as viagens que ainda estão em acerto.',
   'Estranhar a contagem: o filtro muda quantas viagens aparecem na lista; o selo "aberta(s)" no topo continua contando o total de abertas, independente do filtro.',
   'projetos',
   263,
   1,
   'publicado')
ON CONFLICT (chave) DO NOTHING;
