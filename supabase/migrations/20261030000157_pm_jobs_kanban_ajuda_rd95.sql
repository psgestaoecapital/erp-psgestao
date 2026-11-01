-- P&M · Jobs (/dashboard/producao) · auditoria aud8 28/10 (score 68/78): "? (RD-95) nos indicadores e colunas do
-- kanban". Cadastra o texto de ajuda dos 4 KPIs do topo e dos estágios do kanban, para a tela mostrar o "?" do padrão.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.jobs.kpi_clientes_ativos', 'Jobs', 'Clientes ativos',
  'Nada a preencher: é a contagem de clientes da agência com status Ativo.',
  'Mostra quantas contas a agência atende hoje — a base da receita recorrente.',
  '8 clientes ativos.',
  'Confundir com total de clientes: prospects e inativos não entram aqui.', 10, '/dashboard/producao'),
 ('pm.jobs.kpi_jobs_andamento', 'Jobs', 'Jobs em andamento',
  'Nada a preencher: conta os jobs que ainda não foram concluídos (fora do último estágio).',
  'Dá o volume de trabalho aberto na agência agora, somando todos os estágios do kanban menos os concluídos.',
  '12 jobs em andamento entre Briefing, Produção e Revisão.',
  'Achar que inclui jobs já entregues: concluído sai da conta.', 11, '/dashboard/producao'),
 ('pm.jobs.kpi_horas_mes', 'Jobs', 'Horas no mês',
  'Nada a preencher: soma as horas lançadas no timesheet no mês corrente.',
  'Mede o esforço real do mês — base para comparar com o fee e ver a margem por job.',
  '137,5h lançadas neste mês.',
  'Esperar o mês inteiro de uma vez: o número cresce conforme a equipe lança as horas.', 12, '/dashboard/producao'),
 ('pm.jobs.kpi_receita_fees', 'Jobs', 'Receita recorrente (fees)',
  'Nada a preencher: soma o fee mensal dos contratos recorrentes dos clientes ativos.',
  'Mostra a receita previsível da agência no mês — o piso que os fees garantem, fora os jobs avulsos.',
  'R$ 24.000 em fees de 6 contratos mensais.',
  'Somar aqui os jobs avulsos: avulso não é fee; a receita recorrente é só o contrato mensal.', 13, '/dashboard/producao'),
 ('pm.jobs.kanban_estagios', 'Jobs', 'Estágios do kanban',
  'Arraste o card do job entre as colunas para mudar o estágio (ou use o seletor dentro do card no celular).',
  'Cada coluna é um estágio da produção do job, da esquerda (início) para a direita (entrega); o número no topo é a contagem de jobs e o valor é a soma do valor dos jobs da coluna.',
  'Mover um job de Produção para Revisão ao terminar a arte.',
  'Usar o kanban como lista de tarefas: a sub-lista de etapas de cada job fica no botão Etapas, dentro do card.', 14, '/dashboard/producao')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
