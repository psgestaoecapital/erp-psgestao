-- RD-95: "?" nos botões de PERÍODO RÁPIDO da tela /dashboard/analises (Gestão Empresarial).
-- O auditor (16/11) apontou que os controles de filtro do topo tinham "?" individual (empresa,
-- tipo de período, regime, abas) EXCETO os botões de atalho de período (Hoje/Sem/Mês/Tri/6M/Ano,
-- page.tsx:411 quickPeriod). Esta PR cria a chave de ajuda desse atalho; a tela passa a ter o "?"
-- ao lado dos botões. Aditiva/idempotente (upsert por chave): só insere/atualiza chave de ajuda;
-- nada de RLS/cálculo/dado de cliente. Faixa desenvolvedor_4_g (segundos :45). RD-100: termos próprios.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('analises.filtro_periodo_rapido', '/dashboard/analises', 'Análises', 'Período rápido',
   'Atalho: botões que ajustam o período de análise com um toque — Hoje, Semana (Sem), Mês, Trimestre (Tri), Semestre (6M) e Ano.',
   'Troca o intervalo de todos os indicadores e gráficos da tela de uma vez, sem digitar datas — o padrão é o mês atual.',
   'Ex.: toque em "Tri" para ver receitas, despesas e resultado dos últimos três meses sem preencher datas.',
   'Esquecer que o atalho sobrescreve as datas escolhidas à mão: para um intervalo específico, use o tipo "Período" e informe início e fim.',
   'financeiro', 4, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
