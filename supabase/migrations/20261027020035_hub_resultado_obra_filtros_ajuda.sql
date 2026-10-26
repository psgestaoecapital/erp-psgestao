-- Hub · Resultado por obra: "?" dos filtros (busca e situação) e do aviso de receita ainda não medida. Aditiva (só texto de ajuda novo).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.filtro_busca', 'Resultado por obra', 'Buscar obra', 'Digite parte do número ou do nome da obra.', 'Reduz a lista (e o consolidado) às obras que combinam com o texto.', 'Digite "OB-12" ou "Galpão".', 'Achar que o consolidado ignora a busca: ele soma só as obras filtradas.', 22, '/dashboard/projetos/obras/resultado'),
 ('projetos.resultado_obra.filtro_status', 'Resultado por obra', 'Situação da obra', 'Escolha a situação: todas, em andamento, concluídas etc.', 'Mostra o resultado só das obras na situação escolhida.', 'Escolha "Concluída" para fechar o resultado final.', 'Deixar filtro ativo e estranhar obras que sumiram da lista.', 23, '/dashboard/projetos/obras/resultado'),
 ('projetos.resultado_obra.aviso_sem_receita', 'Resultado por obra', 'Receita ainda não medida', 'Nada a preencher: o aviso aparece quando há custo mas nenhuma receita realizada.', 'Explica que a margem fica sem percentual até existir medição do serviço ou venda de material.', 'Registre a medição da obra para a receita aparecer.', 'Ler a margem negativa como prejuízo, quando é só receita ainda não lançada.', 24, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
