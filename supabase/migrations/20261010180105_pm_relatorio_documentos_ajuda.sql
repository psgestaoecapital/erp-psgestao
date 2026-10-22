-- PM-K · Relatório de Documentos: "?" dos filtros e das colunas (RD-95). Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/relatorio-documentos', 'pm', 'publicado'
FROM (VALUES
 ('pm.relatorio_documentos.colunas', 'Relatório', 'Colunas', 'Marque as colunas que quer ver, até o limite indicado.', 'Monta o relatório do seu jeito; a escolha fica guardada para a próxima vez.', 'Cliente, tipo, valor e a faturar.', 'Tentar marcar mais colunas que o limite: desmarque uma antes.', 1),
 ('pm.relatorio_documentos.tipo', 'Filtro', 'Tipo de documento', 'Escolha só fee, só orçamento, ou os dois.', 'Separa o contrato mensal (fee) do orçamento avulso.', 'Só fee.', 'Esquecer o filtro e somar fee com orçamento no mesmo total.', 2),
 ('pm.relatorio_documentos.cliente', 'Filtro', 'Cliente', 'Escolha um cliente ou deixe "Todos os clientes".', 'Mostra os documentos e os totais só desse cliente.', 'MBOX.', 'Achar que o cliente sumiu: confira se há filtro de cliente em uso.', 3),
 ('pm.relatorio_documentos.de', 'Filtro', 'Data inicial', 'Escolha a data a partir da qual quer ver os documentos.', 'Recorta o relatório por período, junto com a data final.', '01/10/2026.', 'Deixar a data final antes da inicial: a lista fica vazia.', 4),
 ('pm.relatorio_documentos.ate', 'Filtro', 'Data final', 'Escolha a data até a qual quer ver os documentos.', 'Fecha o período do relatório, junto com a data inicial.', '31/10/2026.', 'Deixar a data final antes da inicial: a lista fica vazia.', 5)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
