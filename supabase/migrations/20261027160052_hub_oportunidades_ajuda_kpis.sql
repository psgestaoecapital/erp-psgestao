-- Hub · Oportunidades (RD-95 + RD-38, auditor PDCA 27/10, consistência 45): o topo passou a ter um painel de dinheiro
-- que se CRUZA — Em aberto (pipeline) + Ganhas + Perdidas = Total, tudo da mesma lista do funil. Cada indicador novo
-- (Ganhas R$, Perdidas R$, Total no funil) ganha o seu "?". Aditiva: só linhas de ajuda (ON CONFLICT DO NOTHING).
-- Code: desenvolvedor_4_g.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.oportunidades.kpi_ganhas', 'Indicadores', 'Ganhas',
 'Nada a preencher: conta todas as oportunidades já ganhas e soma o valor estimado delas.',
 'Mostra o total fechado (quantidade e R$). O rodapé lembra quantas foram fechadas no mês atual — recorte do total, não um número à parte.',
 '3 · R$ 690.000,00 · 1 em outubro', 'Achar que "1 em outubro" contradiz "3 ganhas": o mês é parte do total, não um segundo número.',
 135, '/dashboard/projetos/oportunidades', 'projetos', 'publicado'),
('projetos.oportunidades.kpi_perdidas', 'Indicadores', 'Perdidas',
 'Nada a preencher: conta as oportunidades marcadas como perdidas e soma o valor estimado delas.',
 'Mostra quanto saiu do funil por perda. Clique no resumo "Perdidas" (acima do board) para ver o motivo de cada uma.',
 '2 · R$ 95.000,00', 'Excluir a oportunidade perdida em vez de marcar como perdida — aí ela some deste número e do histórico.',
 145, '/dashboard/projetos/oportunidades', 'projetos', 'publicado'),
('projetos.oportunidades.kpi_total', 'Indicadores', 'Total no funil',
 'Nada a preencher: é a soma de tudo — em aberto + ganhas + perdidas — em quantidade e em R$.',
 'Fecha a conta: prova que nada sumiu. Em aberto (pipeline) + ganhas + perdidas = total, e a soma das colunas do funil bate com o pipeline.',
 '6 · R$ 884.000,00', 'Comparar o total só com o "em aberto" e achar que faltam cards — ganhas e perdidas saem do funil ativo mas entram no total.',
 155, '/dashboard/projetos/oportunidades', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
