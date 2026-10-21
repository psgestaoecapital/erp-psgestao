-- Canal PS (Rodrigo): "?" (RD-95) da ação "Cancelar boleto" em Financeiro › Receitas a Receber.
-- Só ajuda de tela (aditiva): nenhuma regra de cálculo muda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('receber.boleto.cancelar', 'Boleto', 'Cancelar boleto',
  'Clique quando o cliente pagou por outro meio (Pix, dinheiro, transferência) e o boleto não deve mais valer. O sistema pede confirmação antes de enviar.',
  'Envia ao banco (Sicoob e Sicredi) a baixa do boleto, que deixa de poder ser pago. O título da receita NÃO é cancelado: continua ativo para você dar baixa pelo pagamento recebido ou gerar um novo boleto. Para bancos sem cancelamento pelo sistema (Bradesco), o aviso explica como cancelar no Internet Banking.',
  'Cliente pagou R$ 1.200 em Pix: cancele o boleto e depois dê baixa no título.',
  'Cancelar achando que o título some: ele continua. E não há volta no banco — um boleto cancelado só se refaz gerando outro.',
  10, '/dashboard/financeiro/receber', 'financeiro', 'publicado')
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
