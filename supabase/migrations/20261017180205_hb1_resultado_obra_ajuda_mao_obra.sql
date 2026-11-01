-- HB1: "?" da coluna Mão de obra do Resultado por obra. A tela lê v_obra_resultado_alocado (fonte única, #2687). Só dado de ajuda, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.mao_obra', 'Resultado por obra', 'Mão de obra', 'Nada a preencher: a coluna soma as horas apontadas na obra vezes o custo da hora de cada função.', 'Mostra quanto a equipe custou na obra e entra no custo e na margem.', 'Pedreiro 40 h a R$ 30,00/h = R$ 1.200,00.', 'Esperar valor sem ter apontado horas na obra: sem apontamento a coluna fica em zero.', 22, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
