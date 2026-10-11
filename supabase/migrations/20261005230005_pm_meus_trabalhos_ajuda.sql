-- P&M · Meus Trabalhos (tela 25, blueprint V8): "?" da tela. Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.meus_trabalhos.tela', 'Meus trabalhos', 'Meus trabalhos', 'Nada a preencher: escolha Por prazo, Por início ou Por situação para ver os seus jobs agrupados.', 'Mostra só o que é seu, com a situação na própria linha, 6 indicadores no topo e a agenda da semana ao lado.', 'Por prazo: "Atrasados" no topo, depois cada dia da semana.', 'Procurar job de outra pessoa aqui: use a Pauta, que mostra todos.', 43, '/dashboard/pm/meus-trabalhos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
