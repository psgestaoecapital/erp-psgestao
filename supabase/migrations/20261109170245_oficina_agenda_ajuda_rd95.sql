-- RD-95 ("?" em todo filtro/ação) · Agenda da Oficina — gap do auditor: os filtros de visão (Dia/Semana/Hoje),
-- o filtro de mecânico para impressão ("Todos os mecânicos") e a ação "Imprimir o dia/semana" ficavam sem ajuda
-- (grep AjudaCampo = 0 na tela). Semeia as 3 chaves oficina.agenda.* em erp_ajuda_campo. Catálogo de ajuda é
-- metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.
-- Não toca cálculo nem dado — só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('oficina.agenda.visao','Agenda da Oficina','Visão (Dia / Semana / Hoje)',
 'Escolha como ver a agenda: "Dia" mostra as horas de um dia; "Semana" mostra os sete dias. As setas ← → andam para trás e para frente, e "Hoje" volta para a data de hoje.',
 'Define o período que aparece na tela — do foco em um dia cheio à visão geral da semana. Não altera nada: só muda o que você está olhando.',
 'Clicar em "Semana" e usar → para ver a próxima semana; "Hoje" para voltar.',
 'Achar que a agenda está vazia por estar em outra data: confira se "Hoje" está selecionado antes de concluir que não há agendamentos.',
 1,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.mecanico_imprimir','Agenda da Oficina','Mecânico (para imprimir)',
 'Escolha "Todos os mecânicos" para imprimir a agenda inteira do período, ou um mecânico específico para imprimir só os serviços dele.',
 'Monta a folha de impressão: ou a agenda completa da oficina, ou a lista de um mecânico para entregar em mãos.',
 'Selecionar "João" e imprimir só os agendamentos do João no dia.',
 'Imprimir "Todos" quando queria a folha de um mecânico só: escolha o nome antes de clicar em Imprimir.',
 2,'/dashboard/oficina/agenda','oficina','publicado'),
('oficina.agenda.imprimir','Agenda da Oficina','Imprimir o dia / a semana',
 'Ação (botão). Gera a folha de impressão do período que está na tela (dia ou semana) e do mecânico escolhido ao lado.',
 'Serve para deixar a agenda impressa exposta na oficina, com horário, cliente, veículo e serviço, e espaço para anotar à mão.',
 'Com "Semana" e "Todos os mecânicos", imprimir o quadro da semana para fixar no mural.',
 'Imprimir sem conferir a visão (Dia/Semana) e o mecânico: o que sai no papel é exatamente o que está selecionado na barra.',
 3,'/dashboard/oficina/agenda','oficina','publicado')
ON CONFLICT (chave) DO NOTHING;
