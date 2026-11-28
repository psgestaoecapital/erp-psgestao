-- RD-95: "?" (AjudaCampo) nos campos NOVOS do modal "Vincular vários" — ajuste POR TÍTULO (#10136).
-- A conciliação agrupada passou a aceitar juros/multa/desconto em CADA título vinculado (antes só
-- um âncora). Estes campos novos na tela precisam de ajuda. Aditiva e idempotente (ON CONFLICT DO NOTHING).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('financeiro.conciliacao.ajuste_por_titulo',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Ajustar por título', 'financeiro', 30,
   'Ação (não se preenche): liga/desliga o ajuste POR TÍTULO. Ligado, você informa o juros/multa/desconto de CADA conta vinculada separadamente; desligado, o ajuste é único e cai em um título escolhido.',
   'Quando o banco pagou/recebeu vários títulos com encargos DIFERENTES em cada um, cada título quita com o SEU juros — nenhum fica "parcial" por causa do encargo do outro.',
   'Fatura paga 3 contas atrasadas, cada uma com juros diferente: ligue "Ajustar por título" e informe o juros de cada uma.',
   'Usar o ajuste único quando os títulos têm encargos diferentes — aí só um recebe o juros e os demais ficam parciais.'),
  ('financeiro.conciliacao.ajuste_titulo_juros',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Juros R$ (deste título)', 'financeiro', 31,
   'Valor em reais de juros/acréscimo de atraso pago a mais NESTE título específico (não no grupo todo).',
   'Registra o acréscimo deste título para ele quitar por inteiro; o juros entra como receita/despesa financeira, sem mudar o valor original da conta.',
   'Título R$ 138 recebido com R$ 5,52 de juros: juros 5,52 nesta linha.',
   'Somar o juros de vários títulos numa linha só — informe o de CADA título na linha dele.'),
  ('financeiro.conciliacao.ajuste_titulo_multa',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Multa R$ (deste título)', 'financeiro', 32,
   'Valor em reais de multa de atraso paga a mais NESTE título específico. Soma com o juros como acréscimo do título.',
   'Separa a multa do juros no registro do título, mantendo o valor original intacto e quitando a conta por inteiro.',
   'Título com R$ 2,00 de multa de atraso: multa 2,00 nesta linha.',
   'Lançar multa onde o certo seria desconto (multa é a MAIS, desconto é a MENOS).'),
  ('financeiro.conciliacao.ajuste_titulo_desconto',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Desconto R$ (deste título)', 'financeiro', 33,
   'Valor em reais de desconto concedido NESTE título específico, quando recebeu/pagou menos que a conta e quer quitá-la assim mesmo.',
   'Fecha este título com o valor menor que entrou, registrando a diferença como desconto, sem deixar saldo em aberto.',
   'Título R$ 100 recebido R$ 95 com o resto perdoado: desconto 5,00 nesta linha.',
   'Usar desconto quando o saldo deveria continuar em aberto (aí é baixa parcial, não desconto).')
ON CONFLICT (chave) DO NOTHING;
