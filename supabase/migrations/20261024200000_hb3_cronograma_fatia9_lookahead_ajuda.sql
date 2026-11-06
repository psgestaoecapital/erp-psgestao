-- HB3 (fatia 9) · Cronograma da obra: quadro "Próximas semanas" (lookahead) e "?" do quadro e da escolha do período (RD-95). Aditiva (só texto de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.lookahead', 'Próximas semanas', 'Nada a preencher: o quadro lista sozinho as tarefas não concluídas do período, a partir das datas e do avanço de cada uma.', 'Mostra o que a equipe precisa preparar agora: tarefas atrasadas (já deviam ter terminado), as que começam, as que terminam e as que seguem em andamento no período. Use na reunião da semana para pedir material, mão de obra e equipamento a tempo.', 'Atrasada há 3 dias: impermeabilização. Começa 28/10: alvenaria do 2º pavimento. Termina 02/11: instalações elétricas.', 'Esquecer de atualizar o avanço: tarefa já terminada na obra, mas com avanço abaixo de 100%, continua aparecendo como atrasada.', 30),
 ('projetos.cronograma.lookahead_periodo', 'Período do quadro', 'Escolha quantas semanas olhar para frente: 1, 2 ou 4.', 'Define até que dia o quadro "Próximas semanas" vai. As atrasadas aparecem sempre, qualquer que seja o período.', '2 semanas: de hoje até daqui a 13 dias.', 'Olhar só 1 semana e descobrir tarde a compra de um material com prazo de entrega longo.', 31)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
