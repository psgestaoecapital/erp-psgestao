-- HB1 · Resultado por obra: faixa de KPIs consolidados + alerta de desvio de margem (PDCA aud8).
-- Aditiva/idempotente: só acrescenta chaves de ajuda (RD-95 "?") dos novos indicadores. Não toca dado de cliente.
-- Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.resultado_obra.kpi_receita', '/dashboard/projetos/obras/resultado', 'Resumo', 'Receita realizada',
   'Nada a preencher: soma da receita realizada (serviço medido + material vendido) de todas as obras do filtro.',
   'Mostra, de uma vez, quanto as obras já geraram de receita no período que está na tela.',
   'R$ 357.026,40',
   'Confundir com a receita prevista: aqui é o que já foi medido/vendido, não o contratado.',
   'projetos', 200),
  ('projetos.resultado_obra.kpi_custo', '/dashboard/projetos/obras/resultado', 'Resumo', 'Custo realizado',
   'Nada a preencher: soma de material, viagens, mão de obra apontada e custo fixo rateado de todas as obras do filtro.',
   'Mostra o custo total já incorrido nas obras, para comparar com a receita realizada.',
   'R$ 244.000,00',
   'Esquecer que só entram custos já lançados: o que ainda não foi apontado não aparece.',
   'projetos', 201),
  ('projetos.resultado_obra.kpi_margem', '/dashboard/projetos/obras/resultado', 'Resumo', 'Margem consolidada',
   'Nada a preencher: receita realizada menos custo realizado, somando todas as obras do filtro, com a margem % sobre a receita.',
   'Mostra o resultado financeiro agregado das obras: quanto sobrou e qual o percentual.',
   'R$ 113.000,00 · 31,6%',
   'Ler como margem final: ela muda a cada medição e lançamento de custo.',
   'projetos', 202),
  ('projetos.resultado_obra.kpi_avanco', '/dashboard/projetos/obras/resultado', 'Resumo', 'Avanço financeiro',
   'Nada a preencher: receita realizada ÷ receita prevista e custo realizado ÷ custo previsto, em porcentagem, no total do filtro.',
   'Mostra o quanto das obras já foi faturado e consumido frente ao que foi orçado — se o custo avança mais rápido que a receita, é sinal de atenção.',
   'Receita 55% · Custo 54%',
   'Comparar os dois percentuais sem olhar os valores: custo acima da receita indica margem apertando.',
   'projetos', 203),
  ('projetos.resultado_obra.alerta_situacao', '/dashboard/projetos/obras/resultado', 'Resumo', 'Situação das obras',
   'Nada a preencher: conta quantas obras estão com margem saudável (≥10%), baixa (0–10%), negativa (<0) ou ainda sem medição. Clique para filtrar.',
   'Alerta de desvio de margem: destaca de imediato quantas obras estão com resultado ruim para você agir nelas primeiro.',
   '2 saudáveis · 1 baixa · 1 negativa · 2 sem medição',
   'Tratar "sem medição" como prejuízo: é só falta de lançar a medição, não estouro de custo.',
   'projetos', 204)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();
