-- RD-95 (CEO 08/10): "?" (AjudaCampo) nos campos principais do Diagnóstico da Oficina.
-- O auditor apontou cobertura parcial de "?" na tela /dashboard/oficina/diagnostico (só 4 chaves):
-- faltavam a causa provável (o laudo em si), o KM confirmado e a escolha Serviço/Peça.
-- Migration ADITIVA e idempotente: só acrescenta linhas de ajuda (texto editável sem deploy).
-- Nada de dado de cliente, RLS, grant ou DDL — apenas catálogo de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('oficina.diagnostico.causa', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Causa provável',
   'Descreva, em poucas linhas, o que o mecânico constatou — a causa do problema, não só a queixa do cliente. Escreva o que foi visto na peça/veículo.',
   'É o laudo do diagnóstico: fica registrado na OS, embasa o orçamento e vira o histórico técnico do veículo/objeto.',
   'Barulho ao frear — pastilha dianteira gasta e disco com sulco; precisa trocar pastilha e retificar o disco.',
   'Repetir a queixa do cliente em vez de registrar a causa constatada (ex.: escrever só "faz barulho" sem dizer o que está gasto/quebrado).',
   'oficina', 22, 'publicado'),
  ('oficina.diagnostico.km', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'KM confirmado',
   'Informe a quilometragem atual lida no painel do veículo no momento do diagnóstico (só números).',
   'Registra o KM real na OS: baseia a recomendação de revisões por quilometragem e alimenta o histórico do veículo.',
   '87450',
   'Chutar o KM ou repetir o da última visita em vez de ler o painel agora — o histórico fica errado e a próxima revisão sai na hora errada.',
   'oficina', 23, 'publicado'),
  ('oficina.diagnostico.servico_peca', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Serviço ou Peça',
   'Escolha se vai adicionar um SERVIÇO (mão de obra, busca no tempário) ou uma PEÇA (busca no estoque/catálogo). Uma busca por vez, para não misturar.',
   'Separa mão de obra de material: serviço puxa o tempo padrão do tempário; peça puxa o custo e o saldo do estoque. É o que monta o orçamento certo.',
   'Troca de pastilha = Serviço; a pastilha em si = Peça.',
   'Lançar peça como serviço (ou o contrário): o custo/estoque não casa e o orçamento sai com valor ou tempo errado.',
   'oficina', 24, 'publicado'),
  ('oficina.diagnostico.quantidade', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Qtd',
   'Quantas unidades da peça (ou repetições do serviço) este item precisa. Aceita número com vírgula para medidas (ex.: metros, litros).',
   'Multiplica o preço/tempo unitário pelo total do item: é a base do subtotal que vai ao orçamento.',
   '2 pastilhas = 2; 1,5 metro de mangueira = 1,5.',
   'Deixar 1 quando são várias (ou somar peças diferentes numa linha só) — o orçamento sai menor que o real.',
   'oficina', 25, 'publicado'),
  ('oficina.diagnostico.tempo_estimado', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Tempo estimado (h)',
   'Horas de mão de obra que o serviço deve levar. Quando o serviço vem do tempário, já chega preenchido com o tempo padrão — ajuste se o caso for diferente.',
   'É a base da mão de obra: tempo × valor-hora entra no orçamento e organiza a agenda do mecânico.',
   '0,5 para meia hora; 2 para duas horas.',
   'Confundir com a quantidade de peças, ou zerar o tempo de um serviço que tem mão de obra — a oficina deixa de cobrar o trabalho.',
   'oficina', 26, 'publicado'),
  ('oficina.diagnostico.preco_unitario', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Preço unitário (R$)',
   'Valor de UMA unidade do item (a peça avulsa ou a hora/serviço). Peça do catálogo já sugere o preço; ajuste se negociar diferente.',
   'Com a quantidade, forma o subtotal do item e, somados, o valor do orçamento que o cliente aprova.',
   'Pastilha a R$ 120,00 → 120,00 (a quantidade multiplica depois).',
   'Digitar o valor TOTAL do item no unitário: com a quantidade, o orçamento dobra. O unitário é por unidade.',
   'oficina', 27, 'publicado'),
  ('oficina.diagnostico.severidade', '/dashboard/oficina/diagnostico', 'Diagnóstico da Oficina', 'Severidade',
   'Marque a urgência do item: segurança/parado agora, atenção (resolver logo) ou preventivo (pode esperar a próxima).',
   'Prioriza o que o cliente aprova primeiro e ajuda a explicar o risco de adiar — organiza o orçamento por urgência.',
   'Freio sem pastilha = segurança; filtro de ar sujo = preventivo.',
   'Marcar tudo como segurança (vira ruído e o cliente não distingue o que é crítico) ou deixar sem severidade.',
   'oficina', 28, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;
