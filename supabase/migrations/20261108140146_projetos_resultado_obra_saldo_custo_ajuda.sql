-- RD-95 (CEO 08/10): "?" da coluna "Saldo do custo" (orçado − realizado) na tela Resultado por obra
-- (/dashboard/projetos/obras/resultado) — ONDA 2 do Hub "Da obra ao resultado".
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); não toca dado de cliente. Code: desenvolvedor_4_g.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'projetos', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.saldo_custo', 'Colunas', 'Saldo do custo',
  'Você não preenche: é calculado. Saldo = Custo previsto (orçado) − Custo realizado da obra.',
  'Mostra quanto ainda sobra do orçamento de custo da obra. Positivo (verde) = dentro do orçado; negativo (vermelho) = estouro de custo.',
  'Custo previsto R$ 100.000 e custo realizado R$ 82.000 → Saldo +R$ 18.000 (verde, 18% de folga).',
  'Ler "—" como erro: significa que a obra ainda não tem Custo previsto (orçamento) lançado, então não há orçado para comparar.',
  250, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
