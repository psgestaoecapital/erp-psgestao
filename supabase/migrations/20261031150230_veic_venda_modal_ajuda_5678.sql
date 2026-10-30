-- Chamado #5678 (Alliance): modal "Registrar venda" com cliente do cadastro e valores em moeda. Aditiva: só o texto dos "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('revenda.venda.cliente', '/dashboard/revenda/veiculo', 'Registrar venda', 'Cliente',
  'Digite o nome ou o CPF/CNPJ e escolha o cliente na lista (cadastro de clientes da empresa).',
  'Escolhendo da lista, a venda guarda o cliente e o documento, que a nota fiscal usa como destinatário.',
  'Maria da Silva · 123.456.789-00', 'Digitar o nome à mão sem escolher da lista: a venda fica sem CPF/CNPJ e a nota não sai.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.valor_venda', '/dashboard/revenda/veiculo', 'Registrar venda', 'Valor da venda (R$)',
  'Preço combinado com o cliente. Digite só os números: 100000 vira R$ 100.000,00.',
  'Base da margem, do título a receber e do valor da nota.', 'R$ 100.000,00', 'Esquecer os centavos: 100000 é R$ 1.000,00 no campo; digite 10000000 para R$ 100.000,00.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.entrada', '/dashboard/revenda/veiculo', 'Registrar venda', 'Entrada do cliente (R$)',
  'Quanto o cliente paga de entrada, em reais.', 'Vira um título a receber do cliente.', 'R$ 20.000,00', 'Somar a troca na entrada; o veículo da troca é lançado à parte.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.financiado', '/dashboard/revenda/veiculo', 'Registrar venda', 'Financiado pelo banco (R$)',
  'Valor que o banco paga à loja pelo financiamento.', 'Vira um título a receber do banco.', 'R$ 60.000,00', 'Incluir a entrada do cliente neste valor.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.retorno_banco', '/dashboard/revenda/veiculo', 'Registrar venda', 'Retorno do banco (R$)',
  'Comissão que o banco paga à loja pela operação, em reais.', 'Soma na margem real da venda e vira título a receber do banco.', 'R$ 2.000,00', 'Colocar o retorno como desconto; ele é receita.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.valor_troca', '/dashboard/revenda/veiculo', 'Registrar venda', 'Valor dado na troca (R$)',
  'Quanto a loja aceitou pagar pelo veículo do cliente na troca.', 'Se for maior que a avaliação, a diferença vira desconto embutido na venda.', 'R$ 45.000,00', 'Confundir com o valor de avaliação.',
  'revenda_veiculos', 'publicado'),
 ('revenda.venda.valor_avaliacao', '/dashboard/revenda/veiculo', 'Registrar venda', 'Valor de avaliação do usado (R$)',
  'Quanto o veículo usado realmente vale (tabela/mercado).', 'O usado entra no estoque por este valor.', 'R$ 40.000,00', 'Repetir o valor dado na troca; sem avaliação o sobrepreço fica desconhecido.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
