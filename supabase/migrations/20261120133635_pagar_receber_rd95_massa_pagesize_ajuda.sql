-- RD-95: "?" nos controles que faltavam em Despesas a pagar / Contas a receber
-- (componente compartilhado src/components/financeiro/ListagemPagarReceberView.tsx).
-- Auditoria aud8claudeps 18/11 (Despesas a pagar, nota 85): os KPIs, filtros, colunas e ações
-- JÁ tinham "?"; faltavam a seleção "Itens por página" (paginação) e os dois campos do modal
-- "Alterar em massa" (Campo a alterar / Novo valor). Esta migration só INSERE as chaves de ajuda
-- correspondentes para as duas rotas (pagar e receber) — aditiva, idempotente, sem tocar em dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('financeiro.pagar.itens_por_pagina', '/dashboard/financeiro/pagar', 'Paginação', 'Itens por página',
   'Escolha quantas contas a pagar aparecem por página da lista.',
   'Controla o tamanho da página: menos itens carregam mais rápido; mais itens mostram tudo de uma vez sem precisar virar página.',
   'Numa busca ampla, use 50 por página para rolar menos; em uma conferência rápida, 20 é suficiente.',
   'Confundir o tamanho da página com o total de contas: o rodapé "Mostrando X–Y de Z" mostra o total real do filtro, não só o que está na página.',
   'gestao_empresarial', 40),
  ('financeiro.receber.itens_por_pagina', '/dashboard/financeiro/receber', 'Paginação', 'Itens por página',
   'Escolha quantas contas a receber aparecem por página da lista.',
   'Controla o tamanho da página: menos itens carregam mais rápido; mais itens mostram tudo de uma vez sem precisar virar página.',
   'Numa busca ampla, use 50 por página para rolar menos; em uma conferência rápida, 20 é suficiente.',
   'Confundir o tamanho da página com o total de contas: o rodapé "Mostrando X–Y de Z" mostra o total real do filtro, não só o que está na página.',
   'gestao_empresarial', 40),
  ('financeiro.pagar.massa_campo', '/dashboard/financeiro/pagar', 'Alterar em massa', 'Campo a alterar',
   'Escolha qual informação das contas selecionadas você quer mudar de uma vez — por exemplo vencimento, categoria ou forma de pagamento.',
   'Altera o mesmo campo em várias contas a pagar ao mesmo tempo, sem abrir uma por uma.',
   'Selecione 10 contas e escolha "Data de vencimento" para empurrar todas para o mês seguinte de uma só vez.',
   'Esquecer que contas pagas/conciliadas são puladas ao alterar valor ou vencimento em massa — só as que ainda estão em aberto mudam.',
   'gestao_empresarial', 41),
  ('financeiro.receber.massa_campo', '/dashboard/financeiro/receber', 'Alterar em massa', 'Campo a alterar',
   'Escolha qual informação das contas selecionadas você quer mudar de uma vez — por exemplo vencimento, categoria ou forma de recebimento.',
   'Altera o mesmo campo em várias contas a receber ao mesmo tempo, sem abrir uma por uma.',
   'Selecione 10 contas e escolha "Data de vencimento" para empurrar todas para o mês seguinte de uma só vez.',
   'Esquecer que contas recebidas/conciliadas são puladas ao alterar valor ou vencimento em massa — só as que ainda estão em aberto mudam.',
   'gestao_empresarial', 41),
  ('financeiro.pagar.massa_valor', '/dashboard/financeiro/pagar', 'Alterar em massa', 'Novo valor',
   'Informe o valor que passará a valer no campo escolhido, para todas as contas a pagar selecionadas.',
   'Aplica o mesmo novo valor em lote; o rodapé mostra quantas contas serão afetadas antes de você confirmar.',
   'Campo "Categoria" + novo valor "Aluguel" classifica as 8 contas marcadas de uma vez.',
   'Confirmar sem conferir o resumo "X lançamentos → campo = valor": revise a quantidade e o valor antes de aplicar.',
   'gestao_empresarial', 42),
  ('financeiro.receber.massa_valor', '/dashboard/financeiro/receber', 'Alterar em massa', 'Novo valor',
   'Informe o valor que passará a valer no campo escolhido, para todas as contas a receber selecionadas.',
   'Aplica o mesmo novo valor em lote; o rodapé mostra quantas contas serão afetadas antes de você confirmar.',
   'Campo "Categoria" + novo valor "Mensalidade" classifica as 8 contas marcadas de uma vez.',
   'Confirmar sem conferir o resumo "X lançamentos → campo = valor": revise a quantidade e o valor antes de aplicar.',
   'gestao_empresarial', 42)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  atualizado_em = now();
