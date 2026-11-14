-- RD-95: "?" nos cards de saldo da GE que ainda não tinham ajuda — Caixa (espécie) e Cartão (fatura).
-- Gap do auditor em /dashboard/gestao-empresarial (score_visual 85): o card bancário e o Gerencial já têm
-- "?"/"Como é composto?", mas Caixa (espécie) e Cartão (fatura) não explicavam o que são nem por que ficam
-- SEPARADOS do saldo bancário (nunca somados). ADITIVA: só o texto do "?" (RD-95), sem tabela, função ou dado
-- de cliente — a tela já lê os saldos pela RLS da empresa (saldosPorConta / erp_banco_contas).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/gestao-empresarial', 'financeiro', 'publicado'
FROM (VALUES
  ('ge.saldo.caixa_especie', 'Caixa (espécie)',
   'Nada a preencher: é a soma do saldo das contas do tipo caixa/dinheiro em espécie da empresa (cofre, caixa da loja), separado das contas bancárias.',
   'Mostra quanto a empresa tem em dinheiro vivo, sem misturar com o banco. Fica SEPARADO do saldo bancário de propósito: dinheiro em caixa não aparece em extrato bancário, então somar os dois esconderia a real posição de cada um.',
   'Caixa (espécie) R$ 2.350,00 em 1 conta: é o dinheiro no cofre/caixa da loja hoje, fora do banco.',
   'Esperar que o caixa em espécie apareça no saldo bancário ou na conciliação do banco: ele é contado à parte. Lançar uma sangria/suprimento como movimento de conta bancária infla o saldo do banco.', 1),
  ('ge.saldo.cartao_fatura', 'Cartão (fatura)',
   'Nada a preencher: é a posição das contas do tipo cartão de crédito (o que já foi gasto e ainda vai virar fatura), separada das contas bancárias.',
   'Mostra o comprometido no cartão sem somar no saldo do banco. Fica SEPARADO porque o cartão é uma dívida a vencer (fatura), não dinheiro disponível: somá-lo ao banco daria uma falsa folga de caixa.',
   'Cartão (fatura) R$ 4.800,00 em 1 cartão: é o total lançado no cartão que ainda vai cair na fatura — não entra no saldo bancário.',
   'Tratar o valor do cartão como dinheiro disponível: ele é um compromisso a pagar. Só vira saída de banco quando a fatura é liquidada na conta bancária.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
