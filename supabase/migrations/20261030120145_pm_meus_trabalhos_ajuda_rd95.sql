-- P&M · /dashboard/pm/meus-trabalhos — RD-95: "?" nos 6 indicadores e na Agenda da semana.
-- Gap do auditor aud8claudeps (28/10, nota 68→): "Adicionar ? (RD-95)". A tela é só leitura (6 indicadores +
-- lista + agenda), então não há campo de formulário — mas cada indicador precisa do "?" com o texto do banco.
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.meus_trabalhos.ind_jobs_ativos', 'Meus trabalhos', 'Jobs ativos',
  'Nada a preencher: conta os jobs em andamento em que você é o responsável.',
  'Mostra quantos trabalhos estão sob sua responsabilidade agora — o seu volume aberto.',
  '5 jobs ativos com você.',
  'Confundir com os jobs de toda a agência: aqui só entram os seus.', 10, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.ind_jobs_atrasados', 'Meus trabalhos', 'Jobs atrasados',
  'Nada a preencher: conta os seus jobs ativos cujo prazo já passou.',
  'Aponta o que precisa de atenção imediata — jobs seus que furaram o prazo.',
  '2 jobs atrasados: priorize estes hoje.',
  'Achar que some ao concluir: só sai da conta quando o job é fechado ou o prazo é ajustado.', 20, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.ind_tarefas_ativas', 'Meus trabalhos', 'Tarefas ativas',
  'Nada a preencher: conta as tarefas em aberto atribuídas a você dentro dos jobs.',
  'Mede o detalhe do seu trabalho — as etapas abertas, não só os jobs inteiros.',
  '8 tarefas ativas entre os seus jobs.',
  'Confundir tarefa com job: um job pode ter várias tarefas suas.', 30, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.ind_tarefas_atrasadas', 'Meus trabalhos', 'Tarefas atrasadas',
  'Nada a preencher: conta as suas tarefas ativas cujo prazo já passou.',
  'Aponta as etapas furadas — onde o atraso do job começou.',
  '3 tarefas atrasadas puxando o prazo do job.',
  'Ignorar porque o job ainda não venceu: a tarefa atrasada é o aviso antecipado.', 40, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.ind_inicio_hoje', 'Meus trabalhos', 'Início hoje',
  'Nada a preencher: conta os seus jobs/tarefas cuja data de início é hoje.',
  'Mostra o que começa hoje — para você organizar o dia pelo que entra, não só pelo que vence.',
  '1 job começa hoje.',
  'Confundir início com prazo: início é quando o trabalho deveria começar.', 50, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.ind_prazo_hoje', 'Meus trabalhos', 'Prazo hoje',
  'Nada a preencher: conta os seus jobs/tarefas cujo prazo de entrega é hoje.',
  'Mostra o que vence hoje — a fila do dia por data de entrega.',
  '2 entregas para hoje.',
  'Deixar para o fim do dia: prazo hoje é para resolver dentro do expediente.', 60, '/dashboard/pm/meus-trabalhos'),
 ('pm.meus_trabalhos.agenda', 'Meus trabalhos', 'Agenda da semana',
  'Nada a preencher: lista, por dia da semana, os seus jobs e tarefas com início ou prazo naquele dia.',
  'Dá a visão da semana — distribui o seu trabalho pelos dias em vez de só mostrar o total.',
  'Quarta · 2 jobs e 1 tarefa.',
  'Esperar ver jobs sem data: só aparece o que tem início ou prazo no dia.', 70, '/dashboard/pm/meus-trabalhos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
