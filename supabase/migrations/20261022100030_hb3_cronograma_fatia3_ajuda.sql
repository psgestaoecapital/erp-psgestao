-- HB3 (fatia 3) · Cronograma da obra: "?" das ações e indicadores + legenda da ligação de dependência (RD-95). Aditiva (só texto de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.acao_editar', 'Editar tarefa', 'Nada a preencher: abre a tarefa no formulário para ajustar nome, datas, avanço e dependência.', 'Atualiza a etapa; a barra e a ligação com a predecessora acompanham.', 'Subir o avanço da Alvenaria de 40 para 60%.', 'Mudar o fim sem rever as etapas que dependem dela.', 18),
 ('projetos.cronograma.acao_excluir', 'Excluir tarefa', 'Nada a preencher: pede confirmação e remove a tarefa do cronograma.', 'Tira a etapa e as ligações dela; as outras etapas continuam.', 'Remover uma etapa cadastrada em duplicidade.', 'Excluir uma predecessora e esquecer de religar as etapas seguintes.', 19),
 ('projetos.cronograma.ind_tarefas', 'Tarefas', 'Nada a preencher: mostra quantas etapas a obra tem.', 'Dá a dimensão do cronograma.', '12 tarefas.', 'Esperar que subtarefas somem separado: aqui conta cada etapa cadastrada.', 20),
 ('projetos.cronograma.ind_avanco', 'Avanço geral', 'Nada a preencher: o sistema calcula.', 'Média do avanço de cada tarefa ponderada pela duração dela.', '35% com a fundação pronta e o resto por começar.', 'Comparar com o avanço financeiro: são medidas diferentes.', 21),
 ('projetos.cronograma.ind_fora_base', 'Fora da linha de base', 'Nada a preencher: aparece depois de fixar a linha de base.', 'Conta as tarefas cujo fim passou do fim combinado; a linha tracejada vermelha indica etapa que começa antes da predecessora terminar.', '2 tarefas atrasadas em relação à base.', 'Esperar valor antes de fixar a linha de base: sem ela mostra um traço.', 22)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
