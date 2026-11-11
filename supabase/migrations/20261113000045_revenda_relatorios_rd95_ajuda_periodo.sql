-- Revenda · Relatórios da revenda (/dashboard/revenda/relatorios) · RD-95
-- A tela não tinha nenhum "?" (AjudaCampo). Os únicos campos preenchíveis são o período (De / Até) que
-- define a janela de todos os relatórios (lucro real, comissão, encalhe, ROI por modelo, acerto de preço).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente) cadastra a chave de ajuda do período;
-- o front passa a renderizar o "?" ao lado de "De" e "Até" com esta chave.
-- Faixa de migration do desenvolvedor_4_g (segundos :45), acima da main.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/revenda/relatorios', 'revenda', 'publicado'
FROM (VALUES
 ('revenda.relatorios.periodo','Filtros','Período (De / Até)','Escolha a data inicial e a final das VENDAS que entram nos relatórios. O padrão abre no ano corrente (1º de janeiro até hoje).','Define a janela de todos os números da tela — lucro real, comissão, encalhe, ROI por modelo, sangria por mês e acerto de precificação só contam vendas com data dentro do período.','01/01/2026 a 30/06/2026 para ver o resultado do 1º semestre.','Deixar "De" depois de "Até" (nada aparece), ou estranhar "sem vendas" quando o período escolhido não tem carro vendido — amplie as datas.',1)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
