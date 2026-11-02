-- RD-95 (CEO 08/10): "?" nos elementos novos do RANKING de clientes por score — tela Health Score (P&M)
-- · /dashboard/pm/health-score. A tela passou a mostrar o ranking (fn_agency_score_calcular) com o detalhe de
-- cada componente; esta migration semeia o "?" do bloco de ranking, do filtro de período e do detalhe "por que a nota".
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/health-score', 'pm', 'publicado'
FROM (VALUES
 ('pm.health_score.ranking', 'Health Score · Ranking', 'Ranking de clientes por score',
  'Lista (não é campo): os clientes ativos ordenados do maior para o menor score de saúde no período escolhido.',
  'Mostra de um olhar quem está saudável e quem precisa de atenção, para priorizar o relacionamento e evitar churn.',
  'O cliente no topo (ex.: 92 · saudável) vai bem; os do fim (ex.: 38 · crítico) pedem ação.',
  'Comparar scores de períodos diferentes como se fossem o mesmo: o período escolhido muda a base do cálculo.',
  10),
 ('pm.health_score.periodo', 'Health Score · Ranking', 'Período',
  'Escolha a janela de tempo usada no cálculo do score: 90 dias, 180 dias ou 12 meses.',
  'Define sobre quantos dias os componentes (prazo, margem, pagamento, atividade) são apurados — janela maior suaviza oscilações.',
  'Em "90 dias" o score reflete o trimestre recente; em "12 meses", o ano.',
  'Ler um score baixo como churn sem olhar o período: uma janela curta pode refletir só um mês ruim.',
  11),
 ('pm.health_score.detalhe', 'Health Score · Ranking', 'Por que esta nota',
  'Detalhe (não é campo): abre os 4 componentes do cliente (entregas no prazo, margem, pagamento, atividade) com o valor de cada um e o peso aplicado.',
  'Explica a nota — mostra qual componente puxou o score para cima ou para baixo e quais não tinham dado.',
  'Score 70 com "pagamento sem dado": a nota saiu só de prazo, margem e atividade (pesos renormalizados).',
  'Somar os componentes na mão e estranhar: componentes sem dado não entram e os pesos são renormalizados sobre os que têm dado.',
  12)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
