-- RD-95 · "?" (AjudaCampo) no NÍVEL DA LISTA de NFS-e · Code: code-desenvolvedor-3
--
-- Origem: auditor_pdca_2 (jornada GE · /dashboard/fiscal/nfse). A JORNADA DE EMISSÃO já está
-- coberta (NFSeEmitirGovModal tem 18 "?"); o bloqueio era só no NÍVEL DA LISTA (NFSeListClient
-- tinha 0 "?"). Esta migration cadastra as chaves usadas pelos filtros, e as ações de cancelar e
-- vincular obra da lista. Texto em linguagem do usuário.
--
-- ADITIVA e IDEMPOTENTE: só INSERT em erp_ajuda_campo com ON CONFLICT (chave) DO UPDATE.
-- Não altera nota fiscal, dado de cliente, função fiscal nem RLS. RD-38: as 7 chaves não existiam
-- na rota (SELECT count(*) WHERE rota='/dashboard/fiscal/nfse' AND chave LIKE 'fiscal.nfse.lista.%' = 0).

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('fiscal.nfse.lista.busca','/dashboard/fiscal/nfse','Filtros','Buscar tomador / número / documento',
   'Digite parte do nome do tomador, o número da NFS-e ou a referência do pedido/orçamento para achar uma nota na lista.',
   'Filtra a lista pelo que você digita; não muda o período nem o status selecionados. Enter aplica a busca.',
   'Digite "Construtora ABC", "000001" ou "PED-ORC-123".',
   'Buscar por um texto que não aparece na nota (ex.: CNPJ sem formatação) e achar que "sumiu" — tente o nome ou o número.',
   'fiscal', 10, 1, 'publicado'),

  ('fiscal.nfse.lista.status','/dashboard/fiscal/nfse','Filtros','Status',
   'Escolha o situação das notas que quer ver: Todos, Autorizada, Processando, Não emitida (só recusas) ou Cancelada.',
   'Mostra só as notas naquela situação. "Não emitida (só recusas)" ajuda a achar o que a prefeitura recusou e precisa reenviar.',
   'Selecione "Processando" para ver o que ainda não voltou da prefeitura.',
   'Achar que uma nota sumiu quando o filtro está em um status específico — volte para "Todos".',
   'fiscal', 20, 1, 'publicado'),

  ('fiscal.nfse.lista.data_inicio','/dashboard/fiscal/nfse','Filtros','De (data inicial)',
   'A data inicial do período das notas que você quer ver (pela data de emissão).',
   'Junto com "Até", limita a lista a um intervalo de datas.',
   'Para ver o mês atual, ponha o dia 1º do mês em "De".',
   'Deixar "De" depois de "Até": o intervalo fica vazio e nada aparece.',
   'fiscal', 30, 1, 'publicado'),

  ('fiscal.nfse.lista.data_fim','/dashboard/fiscal/nfse','Filtros','Até (data final)',
   'A data final do período das notas que você quer ver (pela data de emissão).',
   'Junto com "De", limita a lista a um intervalo de datas.',
   'Para o mês atual, ponha o último dia do mês em "Até".',
   'Deixar "Até" antes de "De": o intervalo fica vazio e nada aparece.',
   'fiscal', 40, 1, 'publicado'),

  ('fiscal.nfse.lista.mostrar_recusadas','/dashboard/fiscal/nfse','Filtros','Mostrar tentativas recusadas',
   'Marque para ver a visão antiga: uma linha por tentativa, incluindo as recusadas, em vez de uma linha por documento.',
   'Por padrão a lista mostra UMA linha por documento (um serviço recusado 4× e depois autorizado é 1 linha). Ligar isto abre cada tentativa separada — útil para auditar recusas.',
   'Ligue para ver todas as recusas de um serviço antes da autorização.',
   'Estranhar a lista "crescer" ao ligar: é a visão por tentativa, não notas novas.',
   'fiscal', 50, 1, 'publicado'),

  ('fiscal.nfse.lista.cancelar_justificativa','/dashboard/fiscal/nfse','Cancelamento','Justificativa do cancelamento',
   'Escreva o motivo do cancelamento da NFS-e, com no mínimo 15 caracteres, de forma clara.',
   'A prefeitura exige o motivo para cancelar. O cancelamento depende do prazo municipal — se o prazo venceu, a prefeitura pode recusar, e o motivo aparece na linha do tempo da nota.',
   'Ex.: "nota emitida em duplicidade para o mesmo serviço".',
   'Justificativa curta demais (menos de 15 caracteres) ou genérica: o botão fica bloqueado e a prefeitura pode recusar.',
   'fiscal', 60, 1, 'publicado'),

  ('fiscal.nfse.lista.vincular_obra','/dashboard/fiscal/nfse','Vínculo','Vincular obra',
   'Ligue a nota a uma obra buscando pelo número, nome, cidade ou endereço da obra. Dá também para trocar ou desvincular depois.',
   'O vínculo com a obra leva a receita e os impostos da nota para o resultado daquela obra (medição, custo, rentabilidade).',
   'Busque "Residencial Jardim" ou o número da obra e selecione na lista.',
   'Deixar a nota sem obra quando ela é de uma obra: o resultado da obra fica sem essa receita.',
   'fiscal', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
