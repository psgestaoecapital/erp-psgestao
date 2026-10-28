-- Resultado por obra: "?" da coluna Custo fixo rateado (v_obra_resultado_alocado.custo_rateio). Só dado de ajuda, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.custo_rateio', 'Resultado por obra', 'Custo fixo rateado', 'Nada a preencher: a coluna mostra a parte dos custos fixos da empresa (aluguel, administração) atribuída a esta obra.', 'Entra no custo e na margem, para a obra não parecer mais lucrativa do que é depois de pagar a estrutura.', 'Custos fixos de R$ 10.000,00 divididos por 4 obras = R$ 2.500,00 por obra.', 'Achar que o rateio é gasto extra da obra: é a fatia da estrutura da empresa que ela consome.', 23, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
