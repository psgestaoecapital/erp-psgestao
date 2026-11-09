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
   'oficina', 24, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;
