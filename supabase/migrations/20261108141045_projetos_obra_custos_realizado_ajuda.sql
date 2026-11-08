-- RD-95 (CEO 08/10): "?" do indicador "Custo realizado" do resumo Orçado × Realizado × Saldo na tela
-- Custos da obra (/dashboard/projetos/obras/[id]/custos) — ONDA 2 do Hub "Da obra ao resultado".
-- O resumo lê v_obra_resultado_alocado (custo real alocado de TODAS as fontes: material, mão de obra,
-- viagem/frota, custo fixo rateado), diferente do "Total de custos" da lista (só os lançamentos desta tela).
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); não toca dado de cliente. Code: desenvolvedor_4_g.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'projetos', 'publicado'
FROM (VALUES
 ('projetos.obra_custos.realizado', 'Custo da obra', 'Custo realizado',
  'Você não preenche: é calculado. Soma do custo real já alocado à obra em TODAS as fontes — material, mão de obra, viagem/frota e custo fixo rateado.',
  'Mostra quanto a obra já consumiu de verdade, para comparar com o orçado e ver o saldo. É mais amplo que o "Total de custos" da lista abaixo, que soma só os custos lançados nesta tela.',
  'Material R$ 8.000 + mão de obra R$ 4.500 + viagem R$ 500 → Custo realizado R$ 13.000.',
  'Estranhar que o Custo realizado seja maior que o Total de custos da lista: a lista mostra só os lançamentos desta tela; o realizado inclui mão de obra por hora, viagem e rateio.',
  260, '/dashboard/projetos/obras/[id]/custos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
