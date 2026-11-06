-- P&M · /dashboard/pm/margem-job — RD-95: "?" nos 4 indicadores (KPIs) do topo.
-- Gap de qualidade (grupo 1 "Margem por Job", só 2 chaves de ajuda): os KPIs Valor total, Custo total, Lucro e
-- Margem geral não tinham o "?". A coluna Margem da tabela por job passou a reusar a chave pm.margem.grupo (já existe).
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.margem.kpi_valor', 'Margem por job', 'Valor total',
  'Nada a preencher: soma o valor (receita) de todos os jobs no filtro atual.',
  'Mostra quanto a agência vai faturar com os jobs considerados — a base de cima da margem.',
  'R$ 120.000 somando os 8 jobs do período.',
  'Confundir com lucro: valor é a receita bruta, antes de tirar o custo.', 10, '/dashboard/pm/margem-job'),
 ('pm.margem.kpi_custo', 'Margem por job', 'Custo total',
  'Nada a preencher: soma o custo dos jobs (horas apontadas × custo/hora + custos lançados).',
  'Mostra quanto esses jobs consomem — o que é descontado do valor para chegar ao lucro.',
  'R$ 72.000 de custo nos mesmos 8 jobs.',
  'Jobs sem custo/hora cadastrado não entram aqui: o custo sai subestimado (veja o aviso da tela).', 20, '/dashboard/pm/margem-job'),
 ('pm.margem.kpi_lucro', 'Margem por job', 'Lucro',
  'Nada a preencher: valor total menos custo total dos jobs no filtro.',
  'Mostra o resultado em reais — quanto sobra depois do custo. Verde positivo, vermelho negativo.',
  'R$ 48.000 de lucro (120 mil − 72 mil).',
  'Ler o lucro sem olhar quantos jobs ficaram sem custo completo: eles não entram na conta.', 30, '/dashboard/pm/margem-job'),
 ('pm.margem.kpi_margem', 'Margem por job', 'Margem geral',
  'Nada a preencher: lucro dividido pelo valor total, em porcentagem.',
  'Mostra a eficiência média dos jobs — quanto por cento do faturamento vira lucro. Cores: ≥50% verde, 25–50% amarelo, abaixo vermelho.',
  '40% de margem (48 mil de lucro sobre 120 mil de valor).',
  'Comparar margens de períodos com muitos jobs sem custo: a margem fica inflada quando falta custo.', 40, '/dashboard/pm/margem-job')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
