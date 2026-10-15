-- Aba Codes · gráficos do histórico (CEO 09/10, fatia 2): "?" dos 3 indicadores. Aditiva (só texto de ajuda novo). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.codes.graficos.main_deploy', 'Main e deploy', 'Nada a preencher: cada ponto é um retrato tirado a cada 15 minutos.', 'Mostra quando a main ou o deploy ficaram quebrados, para agir antes de acumular PRs.', 'Faixa vermelha às 09h: a main ficou quebrada naquele retrato.', 'Gráfico vazio não é erro: o estado só aparece depois que o job de leitura do GitHub for ligado.', 14),
 ('dev.codes.graficos.sessoes', 'Sessões por Code', 'Nada a preencher: soma 15 minutos para cada retrato em que o Code tinha sessão aberta.', 'Mostra quanto cada Code consome da cota de sessões.', 'Um Code com 300 min em 24 h: ficou ativo quase 5 horas.', 'Ler como tempo de trabalho útil: é tempo de sessão aberta, não de produção.', 15),
 ('dev.codes.graficos.mensagens', 'Mensagens abertas por Code', 'Nada a preencher: conta as tarefas ainda não concluídas na caixa de cada Code, no último retrato.', 'Mostra onde a fila está parada ou sobrecarregada.', 'Code com 12 abertas: fila grande, vale priorizar.', 'Contar aviso como tarefa: avisos concluídos não entram.', 16)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
