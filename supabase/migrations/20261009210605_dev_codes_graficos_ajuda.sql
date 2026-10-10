-- Aba Codes · gráficos de desempenho (CEO 09/10): "?" dos 4 indicadores. Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.codes.graficos.periodo', 'Período dos gráficos', 'Escolha Hoje (hora a hora), 7 dias ou 30 dias (dia a dia).', 'Troca a janela de todos os gráficos de uma vez.', '7 dias: vê se a semana teve mais publicações que a anterior.', 'Comparar "Hoje" com "7 dias": um é por hora, o outro por dia.', 10),
 ('dev.codes.graficos.publicacoes', 'Publicações por hora ou dia', 'Nada a preencher: cada barra é um período; as cores são os Codes.', 'Mostra quantas PRs foram publicadas na main e quem as fez.', 'Barra alta às 14h: muitas PRs entraram nessa hora.', 'Ler PR aberta como publicada: só conta PR mergeada.', 11),
 ('dev.codes.graficos.pilha', 'PRs prontas esperando', 'Nada a preencher: a linha sobe quando uma PR fica pronta e desce quando é publicada ou fechada.', 'Mostra se a fila de merge está escoando ou acumulando.', 'Linha subindo o dia todo: a fila está mais lenta que a produção.', 'Contar rascunho: só PR marcada como pronta entra.', 12),
 ('dev.codes.graficos.vazao', 'Vazão: pronta até publicada', 'Nada a preencher: cada ponto é a mediana, em minutos, do tempo entre a PR ficar pronta e ser publicada naquele dia.', 'Mede a velocidade da esteira de ponta a ponta; menor é melhor.', '45 min: metade das PRs do dia publicou em até 45 minutos.', 'Dia sem ponto: não houve publicação, não é erro.', 13)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
