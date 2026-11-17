-- #6874 (cobertura CampoMoeda) + RD-95 — tela /dashboard/odonto/tratamento (Plano de tratamento).
-- Os campos de dinheiro Valor/Desconto/Entrada passaram a usar o CampoMoeda (máscara de R$ ao digitar);
-- RD-95 exige o "?" em cada um — esta migration cadastra as 3 chaves de ajuda que o <AjudaCampo> lê por
-- fn_ajuda_campo_listar('/dashboard/odonto/tratamento'). Aditiva e idempotente (ON CONFLICT (chave)).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('odonto.tratamento.item_valor', '/dashboard/odonto/tratamento', 'Plano de tratamento', 'Valor (R$)',
   'O valor, em reais, do procedimento que você está adicionando ao plano. Já vem preenchido com o preço do procedimento escolhido; ajuste se este caso for diferente.',
   'É o preço que entra no plano para esse procedimento e soma no total do tratamento.',
   'R$ 450,00',
   'Digitar o ponto como separador de milhar. Digite só os números: o campo formata sozinho (ex.: 45000 vira R$ 450,00).',
   'odonto', 1),
  ('odonto.tratamento.desconto', '/dashboard/odonto/tratamento', 'Plano de tratamento', 'Desconto (R$)',
   'O desconto, em reais, a abater do total do plano. Deixe 0,00 se não houver desconto.',
   'Reduz o total do tratamento: o Total mostrado já é a soma dos itens menos este desconto.',
   'R$ 50,00',
   'Informar um valor maior que o total dos itens. O desconto não pode zerar o plano abaixo de R$ 0,00.',
   'odonto', 2),
  ('odonto.tratamento.entrada', '/dashboard/odonto/tratamento', 'Plano de tratamento', 'Entrada (R$)',
   'O valor da entrada, em reais, que o paciente paga à vista ao aprovar o plano. Deixe 0,00 se não houver entrada.',
   'Ao aprovar, a entrada vira a primeira cobrança e o restante é dividido nas parcelas informadas.',
   'R$ 200,00',
   'Informar entrada maior que o total do plano. A entrada deve ser menor ou igual ao total a pagar.',
   'odonto', 3)
ON CONFLICT (chave) DO NOTHING;
