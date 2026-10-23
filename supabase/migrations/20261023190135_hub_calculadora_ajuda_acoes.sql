-- Hub · Calculadora de obra pronta (RD-95): "?" em Sugerir produtos, Mandar para o orçamento e Ver a conta. Só INSERT; idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.calculadora.sugerir_produtos', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 300, 'Sugerir produtos do estoque',
   'Nada a preencher: o sistema procura no estoque o produto que combina com cada item.', 'Liga os itens ao estoque para calcular o custo da lista.',
   'Item "Placa ST 1,20x1,80" ligado à placa do estoque', 'Aceitar a sugestão sem conferir a unidade do produto.'),
  ('projetos.calculadora.mandar_orcamento', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 301, 'Mandar para o orçamento',
   'Escolha antes o orçamento em rascunho que vai receber os itens.', 'Leva a lista calculada para o orçamento sem digitar de novo.',
   'Orçamento 0042 do cliente Silva', 'Mandar duas vezes e duplicar os itens no orçamento.'),
  ('projetos.calculadora.ver_conta', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 302, 'Ver a conta',
   'Nada a preencher: abre o cálculo do item, passo a passo.', 'Mostra de onde vem a quantidade e como ela foi arredondada para compra.',
   '12,4 m² ÷ 2,16 m² por placa = 5,74 → compra 6', 'Comparar a quantidade bruta com a de compra e achar que erra.')
ON CONFLICT (chave) DO NOTHING;
