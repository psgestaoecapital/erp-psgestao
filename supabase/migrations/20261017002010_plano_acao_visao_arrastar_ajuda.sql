-- Chamados #3177/#3181 (Frioeste): plano de ação com quadro arrastável e visão em tabela. Aditivo: só "?" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'industrial.plano_acao.visao', 'Plano de Ação 5W2H', 'Quadro / Tabela',
       'Escolha como ver as ações: Quadro (colunas por status) ou Tabela (uma linha por ação).',
       'No Quadro, arraste o cartão para outra coluna para mudar o status; ao soltar em Concluída o sistema pede o resultado. A Tabela serve para conferir e comparar várias ações de uma vez.',
       'Arrastar o cartão PA-2026-0003 de "Aberta" para "Em andamento".',
       'Soltar o cartão fora das colunas: nada muda. Para concluir é preciso informar o resultado obtido.',
       30, '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
