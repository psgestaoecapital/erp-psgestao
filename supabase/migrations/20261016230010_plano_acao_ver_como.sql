-- Chamados #3177/#3181 (Frioeste): Plano de Ação — arrastar cartão entre colunas e visão em tabela. Aditiva: só ajuda de campo (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.ver_como','Ver como','Escolha entre ver as ações em quadro (colunas) ou em tabela (lista).','No quadro, arraste o cartão para outra coluna para mudar o status; na tabela, veja todas as ações lado a lado.','Tabela para conferir na reunião; quadro para acompanhar o andamento.','Arrastar para "Concluída" sem informar o resultado: o sistema pede o resultado antes de concluir.',30)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
