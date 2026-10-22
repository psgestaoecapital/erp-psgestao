-- Canal PS (Rodrigo, 0c859693): ação "Cancelar boleto" em Financeiro › Receitas a Receber — "?" (RD-95).
-- Só ajuda de tela (ADITIVA): a baixa do boleto é feita pela rota /api/banco/sicoob/cancelar-boleto; o título não muda.
-- Code: rodrigo-code
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'receber.boleto.cancelar', 'Receitas a Receber', 'Cancelar boleto',
  'Use quando o boleto já foi gerado, mas o cliente pagou por outro meio (Pix, dinheiro, transferência). O botão aparece só em boleto registrado no banco e ainda não pago. Antes de enviar, o sistema pede a sua confirmação.',
  'Envia ao banco o comando de baixa: o boleto deixa de poder ser pago. Cancela SÓ o boleto — a receita (título) continua ativa, para você dar baixa pelo pagamento real ou gerar um novo boleto. Quem cancelou, quando e o retorno do banco ficam registrados.',
  'Cliente pagou R$ 1.500,00 por Pix; cancele o boleto para ele não ser pago de novo e dê baixa na receita pelo Pix.',
  'Achar que cancelar o boleto cancela a receita: não cancela. Também não tem volta no banco — se precisar de boleto de novo, gere outro.',
  1, '/dashboard/financeiro/receber', 'financeiro', 'publicado')
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
