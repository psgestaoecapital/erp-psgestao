-- GE · /dashboard/gestao-empresarial/bens — tabela-resumo "Por natureza": chaves de ajuda RD-95 ("?")
-- para as 7 colunas-indicador (Natureza, Qtd, Aquisição, Deprec. acum., Líquido, % deprec., Taxa a.a. média),
-- que ainda não tinham "?" por coluna. ADITIVO e idempotente: só linhas novas em erp_ajuda_campo
-- (ON CONFLICT DO NOTHING). Nenhuma função/view/policy muda. Nenhum dado de cliente é tocado.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('ge.bens.resumo_natureza', '/dashboard/gestao-empresarial/bens', 'Natureza',
  'Coluna — não se preenche aqui.', 'Agrupa os bens por natureza (máquinas, veículos, móveis, terrenos, edificações…) para ver a composição do imobilizado.',
  'Máquinas e equipamentos, Veículos, Terreno.', 'Natureza marcada errada no cadastro muda o agrupamento e a taxa de depreciação esperada.'),
 ('ge.bens.resumo_qtd', '/dashboard/gestao-empresarial/bens', 'Qtd',
  'Coluna — não se preenche aqui.', 'Quantidade de bens ativos dessa natureza no imobilizado da empresa.',
  '8 veículos, 23 máquinas.', 'Bens baixados/vendidos não entram na contagem; se faltar algo, confira se foi baixado por engano.'),
 ('ge.bens.resumo_aquisicao', '/dashboard/gestao-empresarial/bens', 'Aquisição',
  'Coluna — não se preenche aqui.', 'Soma do valor de aquisição (custo histórico) dos bens dessa natureza, antes de depreciar.',
  'R$ 450.000 em máquinas.', 'Valor de aquisição em branco no cadastro subavalia o total da natureza.'),
 ('ge.bens.resumo_deprec_acum', '/dashboard/gestao-empresarial/bens', 'Deprec. acum.',
  'Coluna — não se preenche aqui.', 'Depreciação acumulada de todos os bens dessa natureza desde a aquisição até a competência atual.',
  'R$ 180.000 já depreciados.', 'Bens sem vida útil informada não depreciam e puxam a acumulada para baixo.'),
 ('ge.bens.resumo_liquido', '/dashboard/gestao-empresarial/bens', 'Líquido',
  'Coluna — não se preenche aqui.', 'Valor contábil líquido = aquisição menos depreciação acumulada. É o quanto do bem ainda está no ativo.',
  'R$ 270.000 líquidos.', 'Líquido negativo indica depreciação maior que o valor depreciável (vida útil ou residual errados).'),
 ('ge.bens.resumo_pct_deprec', '/dashboard/gestao-empresarial/bens', '% deprec.',
  'Coluna — não se preenche aqui.', 'Percentual já depreciado da natureza (deprec. acumulada ÷ valor depreciável). Mostra o quanto do bem já virou despesa.',
  '40% depreciado.', 'Terrenos não depreciam; natureza só com terreno aparece com 0% — é o correto.'),
 ('ge.bens.resumo_taxa_aa', '/dashboard/gestao-empresarial/bens', 'Taxa a.a. média',
  'Coluna — não se preenche aqui.', 'Taxa anual média de depreciação dos bens dessa natureza (derivada da vida útil cadastrada).',
  '10% a.a. para veículos, 25% a.a. para informática.', 'Taxa muito fora do padrão fiscal da natureza sinaliza vida útil cadastrada errada.')
ON CONFLICT (chave) DO NOTHING;
