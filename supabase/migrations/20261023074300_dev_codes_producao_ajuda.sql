-- Painel de Codes (CEO 16/10): "?" das séries produzidas × publicadas, saldo e filtro por Code. Aditiva (só texto de ajuda; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.codes.graficos.produzidas', 'PRs produzidas', 'Nada a preencher: conta PRs distintas abertas no período (dourado no gráfico).', 'Mostra o ritmo de produção dos Codes.', '15 produzidas entre 10h e 12h: os Codes abriram 15 PRs nesse intervalo.', 'Contar o mesmo PR duas vezes: cada PR entra uma vez, na hora em que foi aberta.', 20),
 ('dev.codes.graficos.publicadas', 'PRs publicadas', 'Nada a preencher: conta PRs mergeadas na main no período (espresso no gráfico).', 'Mostra quanto a esteira escoou.', '8 publicadas no mesmo intervalo: só 8 chegaram à main.', 'Ler PR aberta como publicada: só conta PR mergeada.', 21),
 ('dev.codes.graficos.saldo', 'Saldo e semáforo', 'Nada a preencher: saldo = produzidas menos publicadas. Verde: publicadas ≥ produzidas. Amarelo: fila cresce até 3 por dia. Vermelho: acima disso.', 'Diz se a fila está crescendo (saldo positivo) ou encolhendo.', '+7: a fila cresceu 7 PRs no período.', 'Achar que saldo positivo é erro de um Code: é o conjunto da esteira.', 22),
 ('dev.codes.graficos.code', 'Filtro por Code', 'Escolha Todos ou um Code; vale para produzidas, publicadas, fila, pilha e vazão.', 'Mostra a produção e a publicação de um Code só.', 'rodrigo-code: só as PRs desse Code.', 'Esquecer o filtro ligado e achar que a esteira parou.', 23)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
