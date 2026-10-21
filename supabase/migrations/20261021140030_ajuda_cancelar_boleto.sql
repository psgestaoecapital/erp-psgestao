-- "?" da ação "Cancelar boleto" (Financeiro › Receitas a Receber) — RD-95. Aditiva: só texto de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'financeiro', 'publicado'
FROM (VALUES
 ('financeiro.receber.cancelar_boleto', 'Receitas a receber', 'Cancelar boleto',
  'Clique quando o cliente pagou por outro meio (Pix, dinheiro, transferência) e o boleto não deve mais ser pago. O sistema pede confirmação antes de enviar ao banco.',
  'Dá baixa no boleto no banco para ele não poder mais ser pago. Só o boleto é cancelado: a receita (título) continua ativa, para você quitar com o pagamento que o cliente fez. Depois você pode gerar um novo boleto, se quiser.',
  'Cliente pagou por Pix: cancele o boleto e depois dê baixa na receita pelo Pix.',
  'Achar que cancelar o boleto cancela a receita — não cancela. Também não aparece para boleto já pago.',
  1, '/dashboard/financeiro/receber')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
