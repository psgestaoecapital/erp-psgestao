-- PDCA GE /dashboard/atendimento (Fila de Melhorias, aud8 80): RD-95 "?" nos filtros/abas/visões.
-- Aditiva e idempotente. Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('atendimento.visao','/dashboard/atendimento','Fila de Melhorias','Visão (Meus / Todos / Sem dono)',
   'Escolha de quem são os chamados que você vê: só os seus, todos da equipe, ou os que ainda não têm dono.',
   'A carteira define para onde o chamado cai, mas toda a equipe enxerga "Todos". "Sem dono" mostra o que precisa ser assumido.',
   '"Sem dono" com número > 0 → há chamado esperando alguém assumir.',
   'Ficar só em "Meus" e perder um chamado sem dono da sua carteira.','suporte',1,1,'publicado'),
  ('atendimento.filtro_responsavel','/dashboard/atendimento','Fila de Melhorias','Responsável',
   'Em "Todos", filtre por quem está responsável pelo chamado.',
   'Ajuda a ver a carga de cada atendente ou achar os chamados de uma pessoa.',
   'Selecionar um colega para ver o que está com ele.','—','suporte',2,1,'publicado'),
  ('atendimento.abas','/dashboard/atendimento','Fila de Melhorias','Abas por situação',
   'Alterna entre Precisa de mim, Em curso, Aguardando o autor e Concluídas.',
   'Separa o que exige ação sua agora do que já está em andamento ou entregue. O número é a contagem de cada situação.',
   '"⏳ Precisa de mim" é por onde começar o dia.',
   'Trabalhar em "Concluídas": são chamados já encerrados.','suporte',3,1,'publicado'),
  ('atendimento.busca','/dashboard/atendimento','Fila de Melhorias','Busca',
   'Digite o número (#14) ou parte do título. A busca varre TODAS as abas.',
   'Acha um chamado específico sem precisar saber em que situação ele está.',
   'Buscar "#21" ou "relatório".','—','suporte',4,1,'publicado'),
  ('atendimento.filtro_empresa','/dashboard/atendimento','Fila de Melhorias','Filtro por empresa',
   'Filtre os chamados por empresa.',
   'Foca nos chamados de um cliente específico.','"Construtora Horizonte".','—','suporte',5,1,'publicado'),
  ('atendimento.filtro_categoria','/dashboard/atendimento','Fila de Melhorias','Filtro por categoria',
   'Filtre por categoria do chamado: bug, melhoria, dúvida ou erro de dado.',
   'Agrupa por tipo de trabalho — ex.: tratar todos os bugs primeiro.','"bug".','—','suporte',6,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
