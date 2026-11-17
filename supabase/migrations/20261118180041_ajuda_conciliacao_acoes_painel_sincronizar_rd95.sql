-- RD-95: "?" (AjudaCampo) nas AÇÕES do painel expandido e no "Sincronizar extrato agora" da Conciliação (inbox).
-- PDCA GE (auditor_pdca_2, /dashboard/financeiro/conciliacao/inbox, gap 1): o cluster de ações manuais do
-- painel expandido (Incluir nova conta / Pesquisar conta existente / Vincular vários / Transferência) e o
-- botão "Sincronizar extrato agora" não tinham "?". Esta fatia cobre os dois, no padrão de grupo já usado
-- em acoes_linha. Aditiva e idempotente (ON CONFLICT DO NOTHING). rota = pathname real onde a tela renderiza.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('financeiro.conciliacao.acoes_painel',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Ações manuais do movimento (Incluir conta / Pesquisar / Vincular vários / Transferência)', 'financeiro', 14,
   'Botões para resolver o movimento à mão quando não há sugestão automática: "Incluir nova conta" cria o título a receber/pagar já casado com o movimento; "Pesquisar conta existente" procura um título já lançado para vincular; "Vincular vários (fatura)" junta vários títulos que fecham o mesmo valor do extrato; "Transferência entre contas" registra um movimento que é só dinheiro saindo de uma conta sua para outra (não é receita nem despesa).',
   'São as saídas manuais quando a conciliação automática não achou par — garante que todo movimento do extrato tenha um destino correto, sem forçar um casamento errado.',
   'Usar "Vincular vários" quando um crédito único no banco quita três boletos; "Transferência entre contas" num TED entre a conta movimento e a poupança da própria empresa.',
   'Usar "Incluir nova conta" para um movimento que já tinha título lançado (duplica o título) em vez de "Pesquisar conta existente".'),
  ('financeiro.conciliacao.sincronizar_extrato',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Sincronizar extrato agora', 'financeiro', 15,
   'Ação (não se preenche): puxa os movimentos mais recentes direto do banco conectado, sem precisar importar um arquivo .OFX à mão. Disponível quando há uma única empresa selecionada e conexão bancária ativa.',
   'Mantém o extrato em dia com um clique quando o banco está conectado — complementa a importação de arquivo .OFX para quem não tem conexão.',
   'Clicar em "Sincronizar extrato agora" no início do dia para trazer os lançamentos da véspera.',
   'Esperar que traga movimentos de um banco sem conexão ativa: aí o caminho é "Importar extrato (OFX)".')
ON CONFLICT (chave) DO NOTHING;
