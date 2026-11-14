-- RD-95 ("?" em TODO campo) · Agenda da Oficina — modais Novo/Editar agendamento.
-- A barra da tela (Visão, Mecânico para imprimir, Imprimir) já tem "?" (migration 20261109170245).
-- Faltavam as ajudas dos CAMPOS do formulário de agendamento (Cliente, Placa, Veículo, Mecânico, Data,
-- Início, Fim e Observação), que apareciam sem o "?" — gap de cobertura RD-95 (relatório de cobertura).
-- Semeia as 8 chaves oficina.agenda.* dos campos do modal em erp_ajuda_campo.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.
-- Não toca cálculo nem dado — só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('oficina.agenda.cliente','Novo agendamento','Cliente',
 'Digite o nome do cliente. Conforme você escreve, o sistema sugere os clientes já cadastrados — escolha um da lista para vincular, ou deixe o nome digitado se for um cliente novo ainda sem cadastro.',
 'Identifica para quem é o atendimento. Escolher o cliente do cadastro liga o agendamento à ficha dele e ajuda o veículo a casar sozinho com a Ordem de Serviço quando chegar.',
 'Digitar "Mar" e escolher "Marcos Silva" na lista; ou digitar um nome novo que ainda não está no cadastro.',
 'Digitar o nome mas não escolher na lista quando o cliente já existe: sem a escolha, o agendamento não fica vinculado à ficha do cliente.',
 4,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.placa','Novo agendamento','Placa (opcional)',
 'Informe a placa do veículo, quando houver. Ao digitar, o sistema sugere placas do histórico de Ordens de Serviço; escolher uma já preenche o veículo. Oficinas sem veículo (torno, usinagem) podem deixar em branco.',
 'Permite que a chegada do veículo case automaticamente com este agendamento e com a Ordem de Serviço. É por isso que placa é o jeito mais seguro de vincular.',
 'Digitar "ABC1D23" e escolher na lista para trazer o modelo junto.',
 'Deixar a placa em branco e também não escolher o cliente do cadastro: sem um dos dois, o agendamento não casa sozinho com a OS e terá de ser vinculado à mão.',
 5,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.veiculo','Novo agendamento','Veículo (opcional)',
 'Informe o modelo do veículo (marca e modelo), quando houver. Ao digitar, o sistema sugere veículos do histórico; escolher um pode preencher a placa junto. Campo opcional.',
 'Deixa claro qual veículo será atendido, útil quando a oficina ainda não tem a placa à mão ou atende o mesmo cliente com mais de um carro.',
 'Digitar "Compass 2017" para registrar o modelo do agendamento.',
 'Preencher só o veículo sem placa nem cliente do cadastro: o vínculo automático com a OS usa a placa ou o cliente, não o texto do modelo.',
 6,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.mecanico','Novo agendamento','Mecânico responsável (opcional)',
 'Digite o nome do mecânico que vai atender. O sistema sugere mecânicos que já aparecem nas Ordens de Serviço; escolha um da lista ou digite um nome avulso. Campo opcional.',
 'Define quem fica responsável pelo serviço e permite imprimir a agenda separada por mecânico, para entregar a folha de cada um.',
 'Escolher "João" para que o agendamento apareça na folha impressa do João.',
 'Deixar sem mecânico quando a oficina usa a impressão por mecânico: o agendamento cai em "sem mecânico" na folha.',
 7,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.data','Novo agendamento','Data',
 'Escolha o dia do atendimento no calendário. Já vem preenchido com o dia que está aberto na tela; troque se o serviço for em outra data.',
 'Define em que dia o agendamento aparece na agenda (na visão Dia e na Semana).',
 'Marcar para a próxima terça-feira escolhendo a data no seletor.',
 'Agendar na data errada por não conferir o dia pré-preenchido: confira a data antes de salvar.',
 8,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.hora_inicio','Novo agendamento','Início',
 'Informe a hora prevista para começar o atendimento (formato 24h, ex.: 09:00). Pode deixar em branco se o atendimento for por ordem de chegada, sem horário marcado.',
 'Posiciona o agendamento na faixa de horário certa na visão Dia e organiza a fila do dia por hora.',
 'Digitar 08:30 para um serviço marcado para a manhã.',
 'Inverter início e fim (fim antes do início): o início é quando o atendimento começa.',
 9,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.hora_fim','Novo agendamento','Fim',
 'Informe a hora prevista para terminar o atendimento (ex.: 10:00). Opcional — serve como estimativa de duração.',
 'Mostra quanto tempo o serviço deve ocupar e ajuda a não marcar dois atendimentos no mesmo horário com o mesmo mecânico.',
 'Digitar 10:00 para um serviço previsto de 08:30 às 10:00.',
 'Colocar um fim anterior ao início: a hora de fim tem de ser depois do início.',
 10,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.observacao','Novo agendamento','Observação',
 'Escreva o que for útil para a chegada: o defeito relatado, peça a conferir, combinados com o cliente. Texto livre.',
 'Deixa registrado o contexto do atendimento, que aparece no cartão do agendamento e na folha impressa da oficina.',
 'Anotar "barulho na suspensão dianteira; cliente traz a peça".',
 'Escrever dados essenciais só aqui quando deveriam ir em campo próprio (cliente, placa): a observação é complemento, não substitui os campos.',
 11,'/dashboard/oficina/agenda','oficina','publicado')
ON CONFLICT (chave) DO NOTHING;
