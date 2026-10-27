-- HB3 (fatia 8) · Cronograma da obra: caminho crítico (folga por tarefa) e "?" do indicador e do filtro (RD-95). Aditiva (só texto de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.ind_caminho_critico', 'Caminho crítico', 'Nada a preencher: o sistema calcula com as datas e as dependências das tarefas.', 'Conta as tarefas sem folga: qualquer dia de atraso nelas empurra o fim da obra. Na lista, elas aparecem com a marca "crítica" e as outras mostram quantos dias de folga têm.', '4 tarefas críticas: fundação, estrutura, cobertura e entrega.', 'Esquecer de ligar as dependências: sem elas, só a tarefa que termina por último aparece como crítica.', 26),
 ('projetos.cronograma.so_criticas', 'Só caminho crítico', 'Marque para ver só as tarefas críticas no gráfico.', 'Ajuda a focar no que não pode atrasar. Desmarque para ver todas as tarefas de novo.', 'Marcado: o gráfico mostra só fundação, estrutura, cobertura e entrega.', 'Achar que as outras tarefas sumiram: elas só estão escondidas pelo filtro.', 27)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
