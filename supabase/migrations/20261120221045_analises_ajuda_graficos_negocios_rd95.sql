-- RD-95 (CEO 08/10): "?" em todo gráfico/indicador. Tela /dashboard/analises tinha blocos de
-- dado REAL sem ajuda (auditor: "cobertura insuficiente"). Acrescenta 3 chaves de ajuda, aditivo
-- e idempotente, para os títulos "Maiores Custos — Real vs Orçado", "Linhas de Receita
-- Identificadas (Dados Reais)" e "Entradas Não-Operacionais". Só catálogo de ajuda; sem tocar
-- dado de cliente, cálculo nem RLS. Code: desenvolvedor_4_g
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'analises.grafico_maiores_custos',
    '/dashboard/analises',
    'Análises',
    'Maiores Custos — Real vs Orçado',
    'Leitura, não preenchimento: lista as maiores categorias de custo do período, com o valor Real ao lado do Orçado e a variação de cada uma.',
    'Mostra onde o gasto estourou (ou ficou abaixo) do previsto, para agir primeiro nas categorias de maior peso e maior desvio.',
    'Ex.: "Pessoal" com Real R$ 120 mil × Orçado R$ 100 mil (+20%) indica estouro que merece revisão antes de categorias menores.',
    'Olhar só o valor Real e ignorar a variação: uma categoria pequena com +80% pode ser o vazamento, enquanto a maior pode estar dentro do orçado.',
    'financeiro',
    41
  ),
  (
    'analises.linhas_receita_reais',
    '/dashboard/analises',
    'Análises',
    'Linhas de Receita Identificadas — Dados Reais',
    'Leitura: as linhas de receita operacional reconhecidas a partir dos dados reais do sistema de origem, da maior para a menor. Clique para ver o detalhe de cada linha.',
    'Revela de onde vem o faturamento de fato e quais produtos/serviços sustentam o negócio — base para decidir onde concentrar esforço comercial.',
    'Ex.: se 3 linhas respondem por 80% da receita, é nelas que uma queda dói mais e um aumento rende mais.',
    'Confundir receita operacional com entradas não-operacionais (empréstimos, transferências): estas aparecem em bloco próprio e não medem a saúde do negócio.',
    'financeiro',
    42
  ),
  (
    'analises.entradas_nao_operacionais',
    '/dashboard/analises',
    'Análises',
    'Entradas Não-Operacionais (Empréstimos, Transferências)',
    'Leitura: entradas de caixa que NÃO vêm da operação — empréstimos, aportes e transferências entre contas da empresa.',
    'Separa o que é fôlego de caixa temporário do que é receita de verdade, para não superestimar o resultado do negócio.',
    'Ex.: um empréstimo de R$ 50 mil engorda o caixa do mês, mas é dívida a pagar — não entra como lucro.',
    'Somar essas entradas à receita operacional e achar que o mês foi melhor do que foi: elas inflam o caixa sem gerar margem.',
    'financeiro',
    43
  )
ON CONFLICT (chave) DO NOTHING;
