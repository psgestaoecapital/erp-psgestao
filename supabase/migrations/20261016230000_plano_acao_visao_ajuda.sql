-- Chamados #3177/#3181 (Frioeste): Plano de Ação ganha visão Quadro/Tabela e arrastar cartão. RD-95: "?" do seletor de visão.
-- Aditiva: 1 linha de ajuda nova (sem tocar dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'industrial.plano_acao.visao', 'Plano de Ação 5W2H', 'Ver como',
       'Escolha entre Quadro (colunas por situação) e Tabela (uma linha por ação).',
       'No Quadro, arraste o cartão com o mouse para outra coluna para mudar a situação da ação; ao soltar em Concluída o sistema pede o resultado. A Tabela mostra todas as ações em lista, boa para conferir e imprimir.',
       'Arrastar o cartão de “Aberta” para “Em andamento”.',
       'Soltar em Concluída e esquecer de descrever o resultado: a ação só conclui com o resultado preenchido.',
       60, '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
