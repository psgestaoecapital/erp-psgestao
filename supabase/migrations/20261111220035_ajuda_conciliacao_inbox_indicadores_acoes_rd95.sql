-- RD-95: "?" (AjudaCampo) nos INDICADORES e nas AÇÕES por linha da tela de Conciliação (inbox) — Fatia 2.
-- aud8 10/11: /dashboard/financeiro/conciliacao tinha ZERO AjudaCampo. A Fatia 1 (#4321) cobriu os
-- controles do topo; esta fatia cobre os indicadores (progresso de fechamento do extrato, valor pendente,
-- datas de referência, filtro por natureza) e o cluster de ações por linha (Ignorar / Ver opções / Conciliar).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). rota = pathname real onde a tela renderiza
-- (o canônico /conciliacao redireciona p/ /inbox).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('financeiro.conciliacao.progresso_fechamento',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Progresso de fechamento do extrato', 'financeiro', 9,
   'Indicador (não se preenche): mostra quantos movimentos do lote já foram resolvidos (conciliados + ignorados) e quantos ainda faltam, com uma barra de progresso.',
   'Dá a visão de quanto falta para fechar o extrato do lote selecionado; "ignorado" conta como resolvido porque é uma decisão, não uma pendência.',
   'Ver "18 de 20 resolvidos · faltam 2" e a barra quase cheia.',
   'Achar que o extrato está fechado olhando só os conciliados: a barra só chega a 100% quando os pendentes zeram.'),
  ('financeiro.conciliacao.valor_pendente',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Valor pendente de conciliação', 'financeiro', 10,
   'Indicador (não se preenche): soma, em reais, dos movimentos ainda pendentes na aba atual, com a contagem de movimentos.',
   'Mostra o tamanho do que falta conciliar em dinheiro, não só em quantidade — ajuda a priorizar o dia.',
   'R$ 12.350,00 · 7 movimento(s) pendentes.',
   'Comparar este valor com o saldo do banco: aqui é só o que falta conciliar, não o saldo da conta.'),
  ('financeiro.conciliacao.datas_referencia',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Datas de referência', 'financeiro', 11,
   'Indicador (não se preenche): "Última atualização" é quando a lista foi recarregada; "Último lançamento" é a data do movimento mais recente do extrato.',
   'Ajuda a saber se o extrato está em dia e se a lista reflete o que você acabou de importar.',
   'Última atualização agora há pouco; último lançamento em 05/11.',
   'Estranhar que um movimento de ontem não aparece sem antes conferir se o extrato foi importado (veja "último lançamento").'),
  ('financeiro.conciliacao.filtro_natureza',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Filtro por natureza (Recebimentos / Pagamentos)', 'financeiro', 12,
   'Filtre os movimentos pendentes por Todos, Recebimentos (entradas) ou Pagamentos (saídas); o número ao lado é a contagem de cada grupo.',
   'Permite tratar primeiro um tipo de movimento — por exemplo, conciliar todos os recebimentos antes dos pagamentos.',
   'Clicar em "Recebimentos (5)" para ver só as entradas do extrato.',
   'Esquecer o filtro em "Pagamentos" e achar que não há recebimentos pendentes.'),
  ('financeiro.conciliacao.acoes_linha',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Ações do movimento (Ignorar / Ver opções / Conciliar)', 'financeiro', 13,
   'Botões de decisão de cada movimento: "Conciliar" casa com a sugestão; "Não é essa" descarta a sugestão; "Ver opções" abre as alternativas rankeadas e as ações manuais; "Ignorar" tira o movimento da fila (reversível).',
   'É onde você decide o destino de cada movimento do extrato — conciliar com um lançamento, escolher outra opção ou ignorar o que não é seu.',
   'Clicar em "Conciliar" quando a sugestão OURO está correta; "Ver opções" quando quer escolher outro título.',
   'Clicar em "Ignorar" por engano: o movimento vai para a aba Ignorados, de onde pode ser reincluído.')
ON CONFLICT (chave) DO NOTHING;
