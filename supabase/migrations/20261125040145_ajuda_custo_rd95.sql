-- RD-95: ajuda "?" dos campos de filtro da tela Custo (/dashboard/custo).
-- Aditiva e idempotente: insere só as 2 chaves novas (Empresa e Período) se ainda não existirem.
-- Não altera estrutura, RLS nem dado de cliente — erp_ajuda_campo é catálogo global de texto de ajuda.
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'custo.empresa', '/dashboard/custo', 'Custo', 'Empresa',
    'Escolha a empresa cujos custos você quer ver no período.',
    'Define de qual empresa o sistema soma receitas, custos e despesas para montar os indicadores de custo e margem.',
    'Indústria de Alimentos LTDA',
    'Comparar o resultado com o de outra empresa sem reparar que o seletor ficou na empresa errada.',
    'industria', 10
  ),
  (
    'custo.periodo', '/dashboard/custo', 'Custo', 'Período',
    'Selecione o mês/ano (competência) dos custos que deseja analisar.',
    'Delimita quais lançamentos entram no cálculo dos indicadores; só o que é daquele mês é considerado.',
    'Novembro/2026',
    'Trocar o mês e esquecer de clicar em "Atualizar" — os números continuam do período anterior.',
    'industria', 20
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.rota = v.rota AND a.chave = v.chave
);
