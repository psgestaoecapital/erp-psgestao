-- Hub · Gestão de Obras · aba Revisões de escopo — AÇÕES de decisão (Blueprint §16 H2). Code: desenvolvedor_4_g.
--
-- Contexto (RD-26 REUSAR): o fluxo de decisão (rascunho→solicitada→aprovada/recusada) já tem a camada
-- de dados guardada por company_id — fn_obra_revisao_solicitar / fn_obra_revisao_aprovar /
-- fn_obra_revisao_recusar (fatia backend desta frente). O que faltava era o CAMINHO na tela: o usuário
-- não tinha por onde SOLICITAR, APROVAR ou RECUSAR uma revisão — a revisão nascia em Rascunho e ficava
-- parada (beco sem saída depois da abertura). Esta fatia liga os botões de decisão na própria aba
-- /revisoes às RPCs já existentes e guardadas.
--
-- Esta migration NÃO cria/altera tabela nem função: só SEMEIA as chaves de ajuda ("?") das 3 ações
-- novas (RD-95: toda ação tem "?" com chave existente no banco).
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.revisao.acao_solicitar', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Solicitar aprovação',
   'Clique para enviar a revisão que está em Rascunho para aprovação. A revisão passa para a situação "Solicitada".',
   'Separa o rascunho (ainda em edição) da revisão pronta para decisão — só uma revisão solicitada pode ser aprovada ou recusada.',
   'Terminou de montar os itens da revisão? Clique em "Solicitar aprovação" para enviá-la ao responsável.',
   'Esperar que a revisão mude o contrato ao ser solicitada — ela só move o valor quando for aprovada.', 17),

  ('projetos.revisao.acao_aprovar', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Aprovar revisão',
   'Aprova uma revisão solicitada. Ao aprovar, a nova quantidade e/ou o novo preço de cada item passam a valer no escopo contratado da obra.',
   'É a aprovação que efetivamente MOVE o valor contratado — por isso só deve ser feita quando o aditivo estiver acordado.',
   'Aprovou o acréscimo de alvenaria com o cliente? Clique em "Aprovar" para o novo valor entrar no contrato da obra.',
   'Aprovar com a quantidade de um item abaixo do que já foi medido — o sistema recusa: o medido é o piso do escopo.', 18),

  ('projetos.revisao.acao_recusar', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Recusar revisão',
   'Recusa uma revisão solicitada. Ela fica registrada no histórico como Recusada e NÃO altera o valor contratado. Informe o motivo da recusa (opcional).',
   'Mantém o rastro de uma mudança que foi analisada e não aprovada, sem mexer no contrato.',
   'Recuse a revisão quando o acréscimo pedido não for aceito e descreva o motivo para registro.',
   'Recusar uma revisão já aprovada — só uma revisão na situação "Solicitada" pode ser recusada.', 19)
ON CONFLICT (chave) DO NOTHING;
