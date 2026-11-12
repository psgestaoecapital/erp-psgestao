-- Inteligência (BI) · Análise de Dados (/dashboard/inteligencia) · RD-95: o auditor pediu "?" também
-- nas SEÇÕES de indicadores (além dos 2 indicadores gerais do hub, já cobertos). Esta PR adiciona o "?"
-- em cada seção do hub — industrial (Entrada/Abate/Frio/Saída/Transversais) e agro (Rebanho/Desempenho/
-- Nutrição/Financeiro/Cruzamento) — explicando, em linguagem do usuário, o que cada grupo reúne.
-- Code: desenvolvedor_4_g.
--
-- Metadado de ajuda (erp_ajuda_campo, lido por fn_ajuda_campo_listar). NÃO toca dado de cliente, função,
-- RLS nem regra fiscal/financeira. Idempotente (ON CONFLICT (chave) DO UPDATE). Aditivo. Faixa :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 -- industrial
 ('bi.secao.industrial.entrada', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Entrada e gado',
  'Não preenche — é um grupo de indicadores de leitura. Reúne os cards do começo da cadeia: entrada de gado, compra e recebimento no curral.',
  'Enxergar de onde vem o volume que abastece a operação e como está a entrada no período.',
  'Abrir "Entrada e gado" para ver cabeças recebidas e origem no mês.',
  'Procurar aqui dados de abate ou de venda: esses estão nas seções "Abate e carcaça" e "Saída e mercado".',
  'industrial', 10, 1, 'publicado'),
 ('bi.secao.industrial.abate', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Abate e carcaça',
  'Não preenche — é um grupo de indicadores. Reúne os cards do abate: rendimento de carcaça, quebra e classificação.',
  'Acompanhar a eficiência do abate (quanto de carcaça sai do gado que entrou).',
  '"Abate e carcaça" → rendimento médio e quebra da semana.',
  'Confundir rendimento (carcaça/vivo) com margem financeira: aqui é indicador operacional, não resultado em R$.',
  'industrial', 11, 1, 'publicado'),
 ('bi.secao.industrial.frio_desossa', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Frio e desossa',
  'Não preenche — é um grupo de indicadores. Reúne os cards de câmara fria e desossa: estoque resfriado, cortes e aproveitamento.',
  'Ver o que está no frio e como a desossa aproveita a carcaça.',
  '"Frio e desossa" → cortes produzidos e saldo em câmara.',
  'Esperar aqui a saída/faturamento: isso está em "Saída e mercado".',
  'industrial', 12, 1, 'publicado'),
 ('bi.secao.industrial.saida', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Saída e mercado',
  'Não preenche — é um grupo de indicadores. Reúne os cards da ponta de venda: expedição, mercado e preços de saída.',
  'Acompanhar o que sai e como o mercado está pagando.',
  '"Saída e mercado" → volume expedido e preço médio no período.',
  'Usar estes números como resultado final: margem e custo aparecem nas análises financeiras, não nesta seção.',
  'industrial', 13, 1, 'publicado'),
 ('bi.secao.industrial.transversais', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Transversais · toda a cadeia',
  'Não preenche — é um grupo de indicadores. Reúne os cards que valem para toda a operação: gente, qualidade, energia e custos gerais.',
  'Ver os temas que atravessam entrada, abate, frio e saída de uma vez só.',
  '"Transversais" → custo de folha por setor e indicadores de qualidade.',
  'Procurar um tema específico de uma etapa aqui: se é só de abate ou só de saída, está na seção daquela etapa.',
  'industrial', 14, 1, 'publicado'),
 -- agro
 ('bi.secao.agro.rebanho', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Rebanho e campo',
  'Não preenche — é um grupo de indicadores de leitura. Reúne os cards do rebanho no campo: efetivo, lotes e movimentação.',
  'Enxergar o tamanho e a composição do rebanho na fazenda.',
  '"Rebanho e campo" → cabeças por categoria e por pasto.',
  'Esperar aqui indicadores financeiros: esses estão na seção "Financeiro".',
  'agro', 20, 1, 'publicado'),
 ('bi.secao.agro.desempenho', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Desempenho',
  'Não preenche — é um grupo de indicadores. Reúne os cards de desempenho zootécnico: ganho de peso, GMD e índices de produção.',
  'Acompanhar como o rebanho está ganhando peso e produzindo.',
  '"Desempenho" → ganho médio diário (GMD) do lote no período.',
  'Confundir desempenho (kg/dia) com resultado em R$: o financeiro fica na seção própria.',
  'agro', 21, 1, 'publicado'),
 ('bi.secao.agro.nutricao', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Nutrição',
  'Não preenche — é um grupo de indicadores. Reúne os cards de nutrição: consumo, dieta e eficiência alimentar.',
  'Ver quanto o rebanho consome e a eficiência da dieta.',
  '"Nutrição" → consumo de ração e conversão alimentar do lote.',
  'Usar consumo isolado sem olhar o desempenho: eficiência é consumo x ganho de peso juntos.',
  'agro', 22, 1, 'publicado'),
 ('bi.secao.agro.financeiro', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Financeiro',
  'Não preenche — é um grupo de indicadores. Reúne os cards financeiros do agro: custo por arroba, receita e margem.',
  'Acompanhar o resultado econômico da atividade.',
  '"Financeiro" → custo por arroba produzida e margem do período.',
  'Esperar aqui dados de rebanho ou nutrição: cada um tem sua própria seção.',
  'agro', 23, 1, 'publicado'),
 ('bi.secao.agro.cruzamento', '/dashboard/inteligencia', 'Análise de dados · Seções', 'Cruzamento',
  'Não preenche — é um grupo de indicadores. Reúne os cards que cruzam temas (ex.: desempenho x nutrição x financeiro) para uma visão integrada.',
  'Relacionar indicadores de áreas diferentes para enxergar causa e efeito.',
  '"Cruzamento" → ganho de peso x custo da dieta no mesmo lote.',
  'Procurar aqui um único indicador: os cards de cruzamento combinam temas; o número isolado está na seção de origem.',
  'agro', 24, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();
