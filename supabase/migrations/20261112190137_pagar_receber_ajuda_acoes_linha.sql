-- Gestão Empresarial · Contas a Pagar (/dashboard/financeiro/pagar) e a Receber (/dashboard/financeiro/receber)
-- As duas telas renderizam o MESMO componente (src/components/financeiro/ListagemPagarReceberView.tsx), com `tipo`.
-- Gap residual do auditor PDCA GE (RD-95): as AÇÕES DE LINHA "Marcar pago/recebido", "Bloquear/Desbloquear",
-- "Editar" (✏️) e "Histórico" (🕐) usavam só o title= nativo, sem o "?" padrão AjudaCampo. Este patch cadastra a
-- chave de ajuda de cada ação de linha; o componente passa a renderizar o "?" ao lado de cada botão.
--   (KPIs, filtros, colunas e ações de cabeçalho já receberam o "?" na 20261110120040.)
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (metadado de sistema); NÃO altera tabela/função/cálculo, RLS nem dado
-- de cliente. Idempotente (ON CONFLICT (chave) DO NOTHING). Versão acima da main, faixa de segundos do
-- code-desenvolvedor-3 (:37).
-- Code: code-desenvolvedor-3

-- ===== Contas a PAGAR — ações de linha =====
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/pagar', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.pagar.acao_marcar_pago', 'Ações na linha', 'Marcar pago',
  'Nada a preencher: botão que abre a baixa da conta — você confirma data de pagamento, valor e conta bancária de saída.',
  'Registra que a despesa foi quitada: o título sai de "em aberto", entra no fluxo de caixa e fica pronto para conciliar com o extrato.',
  'Ao pagar o aluguel, clique em "Marcar pago", confirme a data e a conta de onde saiu o dinheiro.',
  'Marcar pago sem conferir a conta bancária de saída: a baixa alimenta o fluxo de caixa; a conta errada distorce o saldo.', 21),
 ('financeiro.pagar.acao_bloquear', 'Ações na linha', 'Bloquear / Desbloquear pagamento',
  'Nada a preencher: botão (só para perfil master) que trava ou destrava a conta para pagamento — pede um motivo ao bloquear.',
  'Impede que uma conta em disputa ou aguardando aprovação seja paga por engano; o motivo fica registrado para auditoria.',
  'Bloqueie a conta de um fornecedor em negociação até o acerto; depois desbloqueie para liberar a baixa.',
  'Bloquear sem informar o motivo: a justificativa é obrigatória e fica no histórico de quem bloqueou.', 22),
 ('financeiro.pagar.acao_editar', 'Ações na linha', 'Editar',
  'Nada a preencher: botão (✏️) que abre a ficha do lançamento para corrigir valor, vencimento, categoria, fornecedor ou descrição.',
  'Permite ajustar os dados da conta sem precisar excluí-la e lançar de novo.',
  'Corrigir o vencimento de uma conta digitado errado.',
  'Editar uma conta já paga esperando mudar o valor baixado: para isso, cancele o pagamento antes e lance de novo.', 23),
 ('financeiro.pagar.acao_historico', 'Ações na linha', 'Histórico',
  'Nada a preencher: botão (🕐) que mostra quem alterou, excluiu ou duplicou o lançamento, com data e hora.',
  'Dá rastreabilidade (auditoria) de tudo o que aconteceu com aquela conta.',
  'Ver quem mudou o valor de uma conta e quando.',
  'Procurar o histórico de pagamento aqui: este histórico é de alterações; a baixa aparece na coluna Pagamento.', 24)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ===== Contas a RECEBER — ações de linha =====
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.receber.acao_marcar_recebido', 'Ações na linha', 'Marcar recebido',
  'Nada a preencher: botão que abre a baixa do título — você confirma data de recebimento, valor e conta bancária de entrada.',
  'Registra que o cliente pagou: o título sai de "em aberto", entra no fluxo de caixa e fica pronto para conciliar com o extrato.',
  'Quando o cliente paga a nota, clique em "Marcar recebido", confirme a data e a conta que recebeu.',
  'Marcar recebido sem conferir a conta bancária de entrada: a baixa alimenta o fluxo de caixa; a conta errada distorce o saldo.', 21),
 ('financeiro.receber.acao_editar', 'Ações na linha', 'Editar',
  'Nada a preencher: botão (✏️) que abre a ficha do título para corrigir valor, vencimento, categoria, cliente ou descrição.',
  'Permite ajustar os dados do recebível sem precisar excluí-lo e lançar de novo.',
  'Corrigir a categoria de uma receita classificada errado.',
  'Editar um título já recebido esperando mudar o valor baixado: para isso, estorne o recebimento antes e lance de novo.', 22),
 ('financeiro.receber.acao_historico', 'Ações na linha', 'Histórico',
  'Nada a preencher: botão (🕐) que mostra quem alterou, excluiu ou duplicou o título, com data e hora.',
  'Dá rastreabilidade (auditoria) de tudo o que aconteceu com aquele recebível.',
  'Ver quem alterou o vencimento de um título e quando.',
  'Procurar o histórico de recebimento aqui: este histórico é de alterações; a baixa aparece na coluna Recebimento.', 23)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
