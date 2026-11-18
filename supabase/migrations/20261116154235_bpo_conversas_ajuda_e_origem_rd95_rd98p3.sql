-- RD-95 (AjudaCampo "?") + RD-98 p3 (origem do dado) da tela /dashboard/bpo/conversas.
-- Auditor (aud8 85/95): a tela do inbox de Conversas não tinha nenhum "?" (AjudaCampo=0) e
-- system_screens.views_consumidas/rpcs_chamadas estavam NULL.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) em erp_ajuda_campo (catálogo de ajuda,
-- editável sem deploy) + UPDATE de METADADO em system_screens. Nenhum dado de cliente, schema,
-- RLS ou permissão. Re-rodar resulta no mesmo estado.
-- Objetos conferidos no banco (RD-38): bpo_conversas, bpo_mensagens, companies,
-- fn_bpo_listar_conversas_operador, fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Code: code-desenvolvedor-3

-- 1) Chaves de ajuda ("?") — indicadores, filtros e ação da tela de Conversas (BPO)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('bpo.conversas.kpi.aguardando','/dashboard/bpo/conversas','Indicadores','Aguardando você',
   'Indicador — não se preenche. Conta as conversas em que a última mensagem é do cliente e você é o operador responsável: a bola está do seu lado.',
   'É a sua fila do dia: o número que você precisa zerar. Clique numa conversa para responder e tirá-la daqui.',
   'Mostra "3": há 3 clientes esperando a sua resposta agora.',
   'Fica vermelho e não zera? Você respondeu pela conversa mas não enviou, ou a conversa ainda está como "aguardando operador" — abra e conclua a resposta.',
   'gestao_empresarial', 10, 1, 'publicado'),

  ('bpo.conversas.kpi.nao_lidas','/dashboard/bpo/conversas','Indicadores','Não lidas',
   'Indicador — não se preenche. Soma as mensagens de cliente ainda não marcadas como lidas, em todas as conversas da sua visão atual.',
   'Mede quanto há de novo para ler, mesmo em conversas que não são só suas. Abrir a conversa marca as mensagens como lidas e baixa este número.',
   'Mostra "7": 7 mensagens novas de clientes para ler.',
   'Não baixa ao abrir? A marca de leitura só cai quando a conversa é efetivamente aberta na tela de detalhe — abrir o card e voltar sem entrar não conta.',
   'gestao_empresarial', 20, 1, 'publicado'),

  ('bpo.conversas.kpi.sla_vencido','/dashboard/bpo/conversas','Indicadores','SLA vencido',
   'Indicador — não se preenche. Conta as conversas cujo prazo de resposta (SLA) já passou da hora.',
   'É o alerta de atraso: toda conversa aqui já estourou o prazo combinado e precisa de resposta imediata. O card fica vermelho.',
   'Mostra "2": 2 conversas passaram do prazo de resposta.',
   'Conta algo que você já respondeu? O SLA só zera quando a conversa muda para "Resolvida" — responder sem resolver mantém o prazo correndo.',
   'gestao_empresarial', 30, 1, 'publicado'),

  ('bpo.conversas.kpi.sla_urgente','/dashboard/bpo/conversas','Indicadores','SLA urgente',
   'Indicador — não se preenche. Conta as conversas cujo prazo de resposta vence nas próximas 2 horas.',
   'É o aviso de "quase vencendo": priorize estas antes que virem SLA vencido. O card fica amarelo.',
   'Mostra "1": 1 conversa vence o prazo dentro de 2 horas.',
   'Zero aqui mas vencidos subindo? Conversa urgente que não é respondida a tempo deixa de ser "urgente" e passa a "vencido" — acompanhe os dois juntos.',
   'gestao_empresarial', 40, 1, 'publicado'),

  ('bpo.conversas.filtro.visao','/dashboard/bpo/conversas','Filtros','Ver (minhas / urgentes / todas)',
   'Escolha quais conversas a lista mostra: "Minhas conversas" (as que você é responsável), "Urgentes" (alta/urgente ou com prazo apertado) ou "Todas" (do seu acesso).',
   'Define o recorte da lista abaixo e dos cards. Começa em "Minhas" para você focar na sua fila; troque para "Todas" ao cobrir um colega.',
   'Cobrindo o plantão? Troque para "Todas" e veja a caixa do time inteiro.',
   'Lista vazia de repente? Você está em "Minhas conversas" e não é responsável por nenhuma — mude para "Todas".',
   'gestao_empresarial', 50, 1, 'publicado'),

  ('bpo.conversas.filtro.busca','/dashboard/bpo/conversas','Filtros','Buscar',
   'Digite parte do nome da empresa, do assunto, do cliente ou do texto da última mensagem. A busca filtra a lista já carregada (atalho Ctrl+K).',
   'Encontra rápido uma conversa específica sem rolar a lista. Combina com o filtro de visão: busca dentro do que está sendo mostrado.',
   'Digite "contrato" para ver só as conversas cujo assunto ou última mensagem cita contrato.',
   'Não acha uma conversa que existe? A busca só procura dentro da visão atual (ex.: "Minhas") — amplie para "Todas" antes de buscar.',
   'gestao_empresarial', 60, 1, 'publicado'),

  ('bpo.conversas.acao.nova','/dashboard/bpo/conversas','Ações','Nova conversa',
   'Botão de ação — abre o formulário para iniciar uma comunicação com um cliente (escolher a empresa, o assunto e a primeira mensagem).',
   'É por aqui que o operador começa o contato quando não há conversa aberta ainda. A conversa criada passa a aparecer nesta lista e a contar no SLA.',
   'Precisa cobrar um documento do cliente? Clique em "+ Nova conversa", escolha a empresa e escreva o pedido.',
   'Abriu duplicada? Antes de criar, busque pelo nome da empresa — pode já existir uma conversa aberta para continuar em vez de abrir outra.',
   'gestao_empresarial', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 2) RD-98 p3 — origem do dado da rota (metadado de catálogo)
--    page.tsx: .rpc('fn_bpo_listar_conversas_operador') + AjudaCampo (fn_ajuda_campo_listar/uso).
--    fn_bpo_listar_conversas_operador lê: bpo_conversas, bpo_mensagens, companies.
UPDATE public.system_screens SET
  views_consumidas = ARRAY['bpo_conversas','bpo_mensagens','companies']::text[],
  rpcs_chamadas = ARRAY[
    'fn_bpo_listar_conversas_operador','fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/bpo/conversas';
