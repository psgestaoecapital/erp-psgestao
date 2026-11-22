-- Hub · tela 310 (Painel de abertura, bloco "Para hoje"): blueprint §310 (relatório 01 · reunião 20/11)
-- pede o "Bloco do dia: compromissos de hoje e dos próximos 7 dias, TAREFAS ATRASADAS, aprovações pendentes
-- e orçamentos sem retorno". O bloco "Para hoje" já trazia compromissos (7 dias), aprovações e orçamentos,
-- mas faltava o lado "atrasado": compromissos da Agenda comercial que já venceram e seguem em aberto.
-- Esta fatia acrescenta o card "Compromissos atrasados" ao bloco "Para hoje", reaproveitando a MESMA fonte
-- da Agenda (erp_agendamento origem_modulo='comercial', RD-26 — não recria): status agendado/confirmado com
-- data < hoje. Esta migration (1) semeia o "?" (RD-95) do novo card e (2) semeia 2 compromissos atrasados
-- fictícios na DEMO do Hub (...006) para a jornada ficar demonstrável (hoje a DEMO tinha 0 atrasados).
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING); catálogo de ajuda + dado só de DEMO (RD-69/LGPD — fictício,
-- empresa DEMO ...006), não toca dado de cliente real, não altera RLS/função. RD-100: sem nome de terceiro.

-- (1) Ajuda "?" do novo card
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.painel.pendencias.compromissos_atrasados', '/dashboard/projetos', 'Para hoje',
   'Compromissos atrasados',
   'Mostra quantos compromissos da Agenda comercial (visitas, reuniões, vistorias) já passaram da data marcada e continuam em aberto (não foram concluídos nem cancelados) nesta empresa.',
   'Chama a atenção para o que ficou para trás: um compromisso vencido e ainda em aberto normalmente é uma visita ou reunião que não aconteceu e precisa ser reagendada ou encerrada. Clique para abrir a Agenda e resolver.',
   'Clique para abrir a Agenda e reagendar ou concluir o compromisso vencido.',
   'Achar que inclui compromissos já realizados: assim que você marca o compromisso como concluído (ou cancela), ele sai deste contador.',
   'hub_projetos', 31, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- (2) Seed DEMO ...006: 2 compromissos atrasados (status em aberto, data no passado), reusando cliente/
-- responsável DEMO já existentes. ids fixos + ON CONFLICT (id) DO NOTHING = re-rodar não duplica.
INSERT INTO public.erp_agendamento
  (id, company_id, origem_modulo, titulo, cliente_id, cliente_nome,
   responsavel_id, responsavel_nome, data, hora_inicio, hora_fim, status, dados, observacao, local)
VALUES
  -- atrasado 1 · agendado · venceu há 5 dias — visita técnica que não foi registrada como concluída
  ('d1111111-0006-4a00-b000-0000000a0007','b0700000-0000-4000-a000-000000000006','comercial',
   'Visita técnica – Residencial Vista Verde','0c3c6dcb-95da-4e8f-bc3c-a5453159196d','Residencial Vista Verde',
   '666fca82-fefb-4a7c-bf35-89463a587e6b','Responsável Demo',
   CURRENT_DATE - 5, '09:30','10:30','agendado',
   jsonb_build_object('seed','pdca-painel-atrasados-ba7f2c10','oportunidade_titulo','Forro e divisórias – Residencial Vista Verde','local','Obra – bloco B'),
   'Visita de levantamento não registrada como concluída; reagendar ou encerrar.','Obra – bloco B'),

  -- atrasado 2 · confirmado · venceu há 2 dias — reunião confirmada que passou em aberto
  ('d1111111-0006-4a00-b000-0000000a0008','b0700000-0000-4000-a000-000000000006','comercial',
   'Reunião de escopo – Clínica Bem Viver','88b284c5-b1d2-49d3-a75e-f63c99e90c5d','Clínica Bem Viver',
   'f3867e65-94d6-43c0-aeb9-8da82fcfe433','Responsável Demo',
   CURRENT_DATE - 2, '14:00','15:00','confirmado',
   jsonb_build_object('seed','pdca-painel-atrasados-ba7f2c10','oportunidade_titulo','Reforma sanitários – Clínica Bem Viver','local','Escritório do cliente'),
   'Reunião confirmada que ficou em aberto; cobrar retorno do cliente e reagendar.','Escritório do cliente')
ON CONFLICT (id) DO NOTHING;
