-- HB1 · Resultado por obra: "?" dos botões Excel e PDF. Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.excel', 'Resultado por obra', 'Baixar Excel', 'Nada a preencher: clique para baixar a tabela como planilha.', 'Leva receita, custo e margem de cada obra para conferir ou enviar ao sócio.', 'Abra no Excel e some por cliente.', 'Esperar o total consolidado na planilha: ele fica só na tela.', 20, '/dashboard/projetos/obras/resultado'),
 ('projetos.resultado_obra.pdf', 'Resultado por obra', 'Baixar PDF', 'Nada a preencher: clique e escolha "Salvar como PDF" na janela de impressão.', 'Gera o relatório pronto para apresentar, com o consolidado no fim.', 'Escolha "Salvar como PDF" como impressora.', 'Esquecer de escolher "Salvar como PDF" e mandar para a impressora.', 21, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
