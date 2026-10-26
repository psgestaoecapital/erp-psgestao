-- HB3 (fatia 12) · Cronograma da obra: quadro "Tarefas no tempo (Gantt)" sobe para logo abaixo dos indicadores, com legenda
-- e marca de hoje; a curva S mostra a linha de base × o planejado pelas datas atuais. "?" do quadro (RD-95).
-- Aditiva (só texto de ajuda); ON CONFLICT DO NOTHING, sem tocar dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.gantt', 'Tarefas no tempo (Gantt)', 'Nada a preencher aqui: cada linha é uma tarefa do cronograma. Para mudar datas, avanço ou dependência, toque em "Editar" na linha.', 'Mostra a obra inteira no calendário: a barra é o prazo atual e a parte cheia é o avanço; a faixa cinza embaixo é a linha de base; borda vermelha marca tarefa crítica (atrasou, atrasa a obra) ou que já passou da base; o tracejado liga a tarefa à que ela depende; a linha tracejada vertical é hoje.', 'Contrapiso 12/10 a 20/10, 60% cheio, borda vermelha: é crítica — um dia de atraso nela empurra a entrega da obra.', 'Olhar só a barra e esquecer a faixa cinza: a tarefa pode parecer em dia e já estar dias além do combinado na linha de base.', 45)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
