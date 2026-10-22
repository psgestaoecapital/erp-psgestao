-- HB3 (fatia 6) · Cronograma da obra: curva S (planejado × realizado) e "?" dos novos indicadores (RD-95). Aditiva (só texto de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.curva_s', 'Curva S', 'Nada a preencher: o gráfico é calculado com as tarefas do cronograma.', 'Mostra quanto da obra deveria estar pronto a cada semana (linha) e quanto está pronto hoje (ponto). Cada tarefa pesa pela duração. Com linha de base fixada, o planejado segue a base.', 'Linha em 40% hoje e ponto em 32%: a obra está 8 pontos atrás do planejado.', 'Fixar a linha de base depois de atrasar: o planejado passa a acompanhar o cronograma atrasado e o desvio some.', 23),
 ('projetos.cronograma.ind_planejado', 'Planejado hoje', 'Nada a preencher: o sistema calcula.', 'Percentual da obra que deveria estar pronto na data de hoje, pela linha de base (ou pelas datas atuais se não houver base).', '40% planejado para hoje.', 'Comparar com o avanço financeiro: aqui é só avanço físico das tarefas.', 24),
 ('projetos.cronograma.ind_desvio', 'Desvio', 'Nada a preencher: avanço geral menos planejado de hoje, em pontos percentuais.', 'Negativo = atrasada em relação ao plano; positivo = adiantada.', '-8 pontos: a obra está atrás do que foi planejado.', 'Atualizar o avanço só no fim do mês: o desvio fica desatualizado até lá.', 25)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
