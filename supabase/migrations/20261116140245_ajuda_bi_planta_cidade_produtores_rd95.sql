-- RD-95: corrige a ajuda do BI da Planta (/dashboard/industrial/bi-planta).
-- Gaps do auditor (aud8): (1) o filtro "Cidade de origem" reusava a chave planta.visao — o "?" não
-- descrevia o filtro de cidade; (2) a tabela "produtores" tinha as 6 colunas sem "?" (só o título da
-- seção tinha ajuda). Aqui entram: planta.cidade (filtro de cidade e o gráfico "De onde veio o gado") e
-- as 6 chaves das colunas da tabela de produtores. Aditivo: só INSERT de texto de ajuda
-- (ON CONFLICT (chave) DO NOTHING), nunca altera dado de cliente, cálculo nem RLS.
-- Code: desenvolvedor_4_g (faixa de segundos :45–:54).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('planta.cidade', 'BI da Planta', 'Cidade de origem',
   'Escolha uma cidade para ver só o gado que veio dos produtores daquela praça. "Todas as cidades" não filtra por origem.',
   'Mostra de onde vem o gado e compara preço e volume por praça — ajuda a decidir em que região vale comprar e qual cidade puxa o custo.',
   'Filtrar por "Barretos" para ver só as compras daquela cidade no período.',
   'Confundir com a "Visão" (Fêmeas/Machos): a cidade filtra a ORIGEM do gado, não o sexo.',
   2, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_produtor', 'Produtores', 'Produtor',
   'Nome do produtor (fornecedor do gado) que vendeu para a planta no período, vindo do ERP de origem.',
   'Identifica quem mais abasteceu a planta — base para negociar preço e priorizar os fornecedores mais relevantes.',
   'Ver que "Fazenda Santa Rita" aparece no topo com o maior volume do mês.',
   'Achar que a lista é de clientes: aqui são os PRODUTORES de onde o gado foi comprado.',
   20, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_cidade', 'Produtores', 'Cidade do produtor',
   'Cidade/praça de origem do produtor. É a mesma origem usada no filtro "Cidade de origem".',
   'Mostra a concentração geográfica dos fornecedores — útil para logística de frete e para mapear regiões de compra.',
   'Dois produtores da mesma cidade indicam uma praça forte para aquela planta.',
   'Confundir a cidade do produtor com a cidade da planta (destino): aqui é a origem do gado.',
   21, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_cabecas', 'Produtores', 'Cabeças',
   'Quantidade de cabeças de gado compradas daquele produtor no período selecionado.',
   'Mede o volume de cada fornecedor — quem traz mais animais tem mais peso na negociação de preço.',
   '320 cabeças de um produtor contra 40 de outro mostra quem é o fornecedor principal.',
   'Comparar cabeças entre períodos diferentes sem conferir o filtro de período no topo.',
   22, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_carcaca', 'Produtores', 'Carcaça média',
   'Peso médio da carcaça (em kg) dos animais comprados daquele produtor no período.',
   'Indica a qualidade/padrão do gado de cada fornecedor — carcaça mais pesada costuma render mais na desossa.',
   'Um produtor com carcaça média de 290 kg entrega animais mais encorpados que outro com 240 kg.',
   'Comparar carcaça média com poucas cabeças: com volume baixo a média oscila muito.',
   23, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_valor', 'Produtores', 'Valor pago',
   'Total em reais pago àquele produtor pelo gado comprado no período (soma de todas as compras dele).',
   'Mostra quanto cada fornecedor representa no custo de compra de gado — concentra onde está o dinheiro.',
   'Pagar R$ 1,2 mi a um produtor contra R$ 180 mil a outro revela a dependência do fornecedor principal.',
   'Ler o valor pago como margem: é o custo da compra, não o resultado do abate.',
   24, '/dashboard/industrial/bi-planta', 'industria', 'publicado'),

  ('planta.prod_arroba', 'Produtores', 'R$ por arroba',
   'Preço médio pago por arroba de carcaça àquele produtor no período. Em vermelho quando está acima da média da planta; em verde quando abaixo.',
   'Compara o preço de cada fornecedor com a média do período — aponta quem está caro e quem está barato para a negociação.',
   'Um produtor a R$ 320/@ enquanto a média é R$ 300/@ aparece em vermelho (pagou-se mais caro).',
   'Comparar o R$/@ entre categorias diferentes de gado sem considerar que a qualidade muda o preço justo.',
   25, '/dashboard/industrial/bi-planta', 'industria', 'publicado')
ON CONFLICT (chave) DO NOTHING;
