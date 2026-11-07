-- P&M · Workspace Produção (/dashboard/producao) · reauditoria auditor_pdca_2 (06/11): as listas Jobs/Clientes/
-- Timesheet eram um rolo plano SEM busca nem filtro (1476 clientes, 1409 lançamentos) — achar 1 item falhava o
-- critério "<=3 toques" (RD-99). Esta PR adiciona campo de busca + filtros por cliente/responsável/status/job nas
-- três abas; cada filtro novo precisa do "?" (RD-95), cujo texto vem do banco. Aqui ficam as 9 chaves novas.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.jobs.filtro_busca', 'Jobs', 'Buscar job',
  'Digite parte do título do job, do número ou do nome do cliente para filtrar a lista enquanto escreve.',
  'Encontra um job específico sem rolar a lista inteira — a tabela mostra só os jobs que casam com o texto.',
  'Digitar "carrossel" para ver só os jobs com essa palavra no título.',
  'Esperar busca exata: a busca é por pedaço do texto, não precisa escrever o título completo.', 20, '/dashboard/producao'),
 ('pm.jobs.filtro_cliente', 'Jobs', 'Filtrar por cliente',
  'Escolha um cliente da agência para ver apenas os jobs dele; deixe em "Todos os clientes" para não filtrar.',
  'Isola os jobs de uma conta — útil para preparar uma reunião ou conferir o andamento de um cliente.',
  'Selecionar "Padaria São José" para listar só os jobs dessa padaria.',
  'Confundir com a busca por texto: aqui é a lista de clientes cadastrados, não um campo livre.', 21, '/dashboard/producao'),
 ('pm.jobs.filtro_responsavel', 'Jobs', 'Filtrar por responsável',
  'Escolha a pessoa responsável para ver só os jobs sob a responsabilidade dela; "Todos" não filtra.',
  'Mostra a carga de trabalho de cada pessoa da equipe — quantos e quais jobs estão com ela.',
  'Selecionar "Marina" para ver os jobs que estão com a Marina.',
  'Esquecer que jobs sem responsável definido não aparecem ao filtrar por uma pessoa.', 22, '/dashboard/producao'),
 ('pm.jobs.filtro_estagio', 'Jobs', 'Filtrar por estágio',
  'Escolha um estágio do kanban (Não iniciada, Em produção, Em aprovação, Concluída, Publicado) para ver só os jobs nele.',
  'Foca a lista num momento da produção — por exemplo, tudo que está em aprovação aguardando o cliente.',
  'Selecionar "Em aprovação" para ver os jobs parados esperando o OK.',
  'Usar o filtro de estágio junto com a busca e achar que a lista zerou: pode ser que nenhum job atenda aos dois ao mesmo tempo — use Limpar.', 23, '/dashboard/producao'),
 ('pm.clientes.filtro_busca', 'Clientes', 'Buscar cliente',
  'Digite parte do nome, nome fantasia, contato, CNPJ/CPF ou e-mail do cliente para filtrar a lista enquanto escreve.',
  'Encontra um cliente específico na hora, mesmo com centenas cadastrados, sem rolar a tabela.',
  'Digitar "jose" para ver todos os clientes com "jose" no nome ou no contato.',
  'Procurar por um dado que o cliente não tem preenchido (ex.: e-mail em branco não casa com a busca).', 20, '/dashboard/producao'),
 ('pm.clientes.filtro_status', 'Clientes', 'Filtrar por status',
  'Escolha o status (Ativo, Prospect, Inativo) para ver só os clientes naquela situação; "Todos" não filtra.',
  'Separa os clientes que a agência atende hoje (Ativo) dos prospects e dos inativos.',
  'Selecionar "Prospect" para trabalhar a lista de quem ainda não fechou.',
  'Achar que a contagem do topo some: ela mostra "filtrados de total" quando há filtro ativo.', 21, '/dashboard/producao'),
 ('pm.timesheet.filtro_busca', 'Timesheet', 'Buscar lançamento',
  'Digite parte do título do job, do tipo de atividade ou da descrição do lançamento para filtrar a lista.',
  'Encontra rapidamente os lançamentos de horas de um trabalho ou de um tipo de atividade.',
  'Digitar "reunião" para ver só os lançamentos dessa atividade.',
  'Esperar filtrar por data no campo de busca: para isso use os filtros; a busca é por texto do job/atividade.', 20, '/dashboard/producao'),
 ('pm.timesheet.filtro_job', 'Timesheet', 'Filtrar por job',
  'Escolha um job para ver só as horas lançadas nele; deixe em "Todos os jobs" para não filtrar.',
  'Soma e confere o esforço aplicado num job específico — base para comparar com o valor e a margem.',
  'Selecionar o job "Campanha de Natal" para ver quantas horas já foram nele.',
  'Confundir com a busca: aqui é a lista de jobs existentes, não texto livre.', 21, '/dashboard/producao'),
 ('pm.timesheet.filtro_responsavel', 'Timesheet', 'Filtrar por responsável',
  'Escolha a pessoa que lançou as horas para ver só os registros dela; "Todos" não filtra.',
  'Mostra quanto cada pessoa da equipe lançou no período — útil para conferir timesheet e produtividade.',
  'Selecionar "Marina" para ver as horas lançadas pela Marina.',
  'Esquecer que o filtro é por quem lançou (autor do registro), não pelo responsável do job.', 22, '/dashboard/producao')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
