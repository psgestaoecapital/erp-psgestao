-- "?" (RD-95) das colunas do Resultado por obra. Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.resultado_obra.receita', 'Colunas', 'Receita',
 'Nada a preencher: soma o serviço medido e o material vendido da obra.',
 'Mostra quanto a obra já faturou ou tem a faturar pelo realizado.', 'R$ 120.000,00', 'Confundir com a receita prevista, que vem do orçamento.', 200, '/dashboard/projetos/obras/resultado', 'projetos', 'publicado'),
('projetos.resultado_obra.custo', 'Colunas', 'Custo',
 'Nada a preencher: soma material, viagens e mão de obra apontada.',
 'É o que a obra já gastou de verdade; base da margem.', 'R$ 85.000,00', 'Esperar custo de horas que ainda não foram lançadas.', 210, '/dashboard/projetos/obras/resultado', 'projetos', 'publicado'),
('projetos.resultado_obra.margem', 'Colunas', 'Margem',
 'Nada a preencher: receita menos custo. Vermelho indica prejuízo.',
 'Mostra se a obra está dando lucro até agora.', 'R$ 35.000,00', 'Ler como margem final: ela muda a cada medição e lançamento.', 220, '/dashboard/projetos/obras/resultado', 'projetos', 'publicado'),
('projetos.resultado_obra.receita_prevista', 'Colunas', 'Receita prevista',
 'Nada a preencher: valor vendido no orçamento aprovado.',
 'Permite comparar o previsto com o realizado.', 'R$ 150.000,00', 'Esperar que mude com o andamento: só muda com aditivo.', 230, '/dashboard/projetos/obras/resultado', 'projetos', 'publicado'),
('projetos.resultado_obra.custo_previsto', 'Colunas', 'Custo previsto',
 'Nada a preencher: custo estimado no orçamento aprovado.',
 'Mostra se o gasto está dentro do planejado.', 'R$ 100.000,00', 'Comparar com o custo antes de haver lançamentos na obra.', 240, '/dashboard/projetos/obras/resultado', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
