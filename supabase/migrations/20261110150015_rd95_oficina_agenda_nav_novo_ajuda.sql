-- RD-95: "?" na navegação de datas (← Hoje →) e no botão "+ Agendar" da tela /dashboard/oficina/agenda.
-- Os filtros Dia/Semana, "Todos os mecânicos" e a ação Imprimir já têm "?"; faltavam a navegação de período e
-- a ação de abrir um novo agendamento. Aditiva/idempotente; nenhuma mudança em RLS/cálculo/dado de cliente.
-- Faixa dev7claudeps (segundos :15).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.agenda.navegacao', '/dashboard/oficina/agenda', 'Oficina', 'Navegar no período',
   'Use ← e → para andar um dia (ou uma semana) para trás/frente; "Hoje" volta para a data atual.',
   'Percorre a agenda sem digitar data; o passo acompanha a visão escolhida (Dia ou Semana).',
   'Toque → para ver a agenda de amanhã; "Hoje" volta para o dia de hoje.',
   'Achar que a agenda está vazia por estar numa data futura/passada — toque "Hoje" para voltar.',
   'oficina', 2, 'publicado'),

  ('oficina.agenda.novo', '/dashboard/oficina/agenda', 'Oficina', 'Novo agendamento',
   'Abre o formulário para marcar um novo agendamento (cliente, veículo/placa, mecânico, data e horário).',
   'Reserva um horário na agenda da oficina para um cliente/serviço.',
   'Toque "+ Agendar" para marcar a revisão das 14h de amanhã.',
   'Tentar agendar sem escolher uma empresa no topo — o botão fica desabilitado até selecionar.',
   'oficina', 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
