-- Hub · Diário de obra (RDO, tela 321) — ajuda do campo de busca no histórico de diários.
-- Blueprint vivo hub_projetos tela 321, requisito 7f49b919 ("Busca nos diários por data,
-- serviço, responsável ou palavra-chave"). A fatia front-only acrescenta a busca livre no
-- histórico; esta migration só cadastra o texto do "?" (RD-95). ADITIVA e IDEMPOTENTE.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, versao, status)
SELECT
  'projetos.obra_rdo.busca',
  '/dashboard/projetos/obras/[id]/rdo',
  'Diário de Obra',
  'Buscar no diário',
  'Digite parte da data, do serviço/OS ou uma palavra das atividades ou ocorrências do diário.',
  'Encontra rápido um diário específico sem rolar toda a lista; combina com o filtro por OS.',
  'Digitar "concretagem" mostra só os diários que citam concretagem; "15/03" acha os desse dia.',
  'Esperar achar por responsável: a busca cobre data, serviço (OS) e o texto do diário.',
  7,
  1,
  'publicado'
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo WHERE chave = 'projetos.obra_rdo.busca');
