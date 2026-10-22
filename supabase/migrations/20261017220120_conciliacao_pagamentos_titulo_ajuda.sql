-- #106 (Jordana · Gean): na conciliação, o título a receber PARCIAL abre em linhas — cada pagamento já registrado
-- (pago, aguardando o extrato, ou conciliado) e o saldo em aberto — e o crédito é conciliado com o pagamento certo.
-- ADITIVA: só o texto do "?" (RD-95) da ação nova. Sem tabela, função ou dado de cliente (a tela lê erp_receber e
-- erp_receber_baixa pela RLS da empresa; a ligação crédito × baixa já existe em fn_receber_conciliacao_sync, #38).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/conciliacao/inbox', 'financeiro', 'publicado'
FROM (VALUES
  ('conciliacao.pagamentos_titulo', 'Pagamentos já registrados no título',
   'Nada a preencher: abra a lista e clique em "Conciliar este pagamento" na linha cujo valor e data batem com o crédito do extrato. A linha com o mesmo valor do extrato aparece destacada.',
   'Separa o que o atendente já marcou como recebido (pago, aguardando o extrato) do saldo que o cliente ainda deve. Ao conciliar um pagamento, o sistema liga o crédito do banco a esse pagamento e ele passa a "Conciliado" — não cria outra baixa nem muda o saldo do título.',
   'Título de R$ 4.703,00 com R$ 2.255,00 marcados como recebidos em 30/09: o extrato traz + R$ 2.255,00 → clique em "Conciliar este pagamento" na linha de R$ 2.255,00; o saldo em aberto continua o mesmo.',
   'Conciliar pelo valor cheio do título quando o crédito é de um pagamento parcial já registrado: escolha a linha do pagamento. Se o crédito é de um valor novo (ainda não registrado), use "Conciliar com o saldo".', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
