-- RD-95: ajuda "?" dos campos do cabeçalho da tela Custeio por Absorção (/dashboard/custeio).
-- Aditiva e idempotente: insere só as 2 chaves novas (Empresa e Período) se ainda não existirem.
-- Não altera estrutura, RLS nem dado de cliente — erp_ajuda_campo é catálogo global de texto de ajuda.
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'custeio.empresa', '/dashboard/custeio', 'Custeio por Absorção', 'Empresa',
    'Escolha a empresa cujo custeio você quer calcular e analisar neste período.',
    'Define de qual empresa o sistema lê os lançamentos, produtos e volumes para ratear os custos e montar o custo por absorção.',
    'Indústria de Alimentos LTDA',
    'Analisar o resultado achando que é do grupo todo: o custeio é por empresa — troque aqui para ver outra.',
    'industria', 10
  ),
  (
    'custeio.periodo', '/dashboard/custeio', 'Custeio por Absorção', 'Período',
    'Selecione o mês/ano (competência) do custeio que deseja processar e visualizar.',
    'Delimita quais lançamentos e produções entram no cálculo; os custos fixos e variáveis são absorvidos dentro desse mês.',
    'Novembro/2026',
    'Esquecer de clicar em "Processar Período" depois de trocar o mês — os números continuam do período anterior até reprocessar.',
    'industria', 20
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.rota = v.rota AND a.chave = v.chave
);
