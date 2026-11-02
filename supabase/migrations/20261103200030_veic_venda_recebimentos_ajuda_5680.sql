-- Chamado #5680 (Alliance): tabela de recebimentos no modal "Registrar venda". Aditiva: só o texto do "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('revenda.venda.recebimentos', '/dashboard/revenda/veiculo', 'Registrar venda', 'Recebimentos da venda',
  'Uma linha por pagamento: tipo, valor, vencimento, forma (Pix, dinheiro, cheque, promissória, boleto, cartão) e conta de destino. Use "À vista" ou "Gerar parcelas iguais" para preencher rápido.',
  'Cada linha vira um título em contas a receber, com a forma e a conta escolhidas; a soma deve bater com o valor da venda menos a troca.',
  'Entrada R$ 20.000 em Pix hoje + 3 cheques de R$ 26.666,67 a cada 30 dias', 'Esquecer de descontar a troca: a soma passa do que o cliente realmente deve pagar.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
