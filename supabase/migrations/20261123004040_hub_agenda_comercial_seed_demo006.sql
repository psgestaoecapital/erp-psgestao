-- Hub · Agenda comercial (/dashboard/projetos/agenda) — SEED DEMO (aud8 90/95, PDCA row 3866)
-- A tela está bem construída (15 AjudaCampo, CRUD completo fn_agendamento_*, calendário dia/semana/mês),
-- mas a DEMO do Hub (empresa ...006 Construtora Modelo) tinha 0 agendamentos comerciais
-- (erp_agendamento origem_modulo='comercial' = 0, provado no dado). Tela abria vazia, impedindo o aud8
-- de verificar os critérios b (dado carrega), c (status muda) e g (Editar/Excluir num registro real).
--
-- AÇÃO: só dado de DEMO (RD-69/LGPD — fictício), aditivo e idempotente. Nenhuma mudança de tela/função.
-- Semeia 6 agendamentos comerciais na DEMO ...006, vinculados a oportunidades/clientes/responsáveis DEMO
-- JÁ EXISTENTES, com datas no passado/hoje/futuro (relativas a CURRENT_DATE, evergreen) e status variados
-- (agendado / confirmado / concluido / cancelado) — exatamente os valores que o AgendaComercialView usa.
-- A listagem da tela filtra company_id + origem_modulo='comercial' + excluido_em IS NULL; estas linhas batem.
--
-- IDEMPOTÊNCIA: ids fixos + ON CONFLICT (id) DO NOTHING. Re-rodar não duplica.
-- SEGURANÇA: só INSERT na empresa DEMO ...006; não toca dado de cliente real; sem alterar RLS/função.

INSERT INTO public.erp_agendamento
  (id, company_id, origem_modulo, titulo, cliente_id, cliente_nome,
   responsavel_id, responsavel_nome, data, hora_inicio, hora_fim, status, dados, observacao, local)
VALUES
  -- 1) passado · concluido — reunião já realizada, vinculada a oportunidade DEMO
  ('d1111111-0006-4a00-b000-0000000a0001','b0700000-0000-4000-a000-000000000006','comercial',
   'Reunião de alinhamento – Clínica Bem Viver','88b284c5-b1d2-49d3-a75e-f63c99e90c5d','Clínica Bem Viver',
   'f3867e65-94d6-43c0-aeb9-8da82fcfe433','Responsável Demo',
   CURRENT_DATE - 14, '09:00','10:00','concluido',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','9d6ef363-19a2-41b3-a511-da9d047bf03f',
     'oportunidade_titulo','Reforma sanitários – Clínica Bem Viver','local','Escritório do cliente'),
   'Alinhamento de escopo da reforma dos sanitários. Fechado o cronograma preliminar.','Escritório do cliente'),

  -- 2) passado · concluido — visita técnica concluída
  ('d1111111-0006-4a00-b000-0000000a0002','b0700000-0000-4000-a000-000000000006','comercial',
   'Visita técnica – Mercado Central','14c04d08-1734-4403-bd39-bafbc985d398','Mercado Central Demo',
   '666fca82-fefb-4a7c-bf35-89463a587e6b','Responsável Demo',
   CURRENT_DATE - 7, '14:30','16:00','concluido',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','b8d87a6b-75e5-470a-bc11-cff78cd6d129',
     'oportunidade_titulo','Revestimento fachada – Mercado Central','local','Obra – fachada principal'),
   'Medição da fachada para o revestimento. Levantadas interferências de andaime.','Obra – fachada principal'),

  -- 3) passado recente · cancelado — compromisso que não aconteceu
  ('d1111111-0006-4a00-b000-0000000a0003','b0700000-0000-4000-a000-000000000006','comercial',
   'Apresentação de proposta – Vista Verde','0c3c6dcb-95da-4e8f-bc3c-a5453159196d','Residencial Vista Verde',
   '43ef8386-3262-4e56-b31a-6f0e41d1e21c','Responsável Demo',
   CURRENT_DATE - 3, '11:00','12:00','cancelado',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','c876682b-9cad-45c0-8498-4d5919484fd4',
     'oportunidade_titulo','Impermeabilização laje – Vista Verde','local','Videochamada'),
   'Cancelado a pedido do cliente; reagendar após aprovação do síndico.','Videochamada'),

  -- 4) hoje · confirmado — compromisso de hoje já confirmado
  ('d1111111-0006-4a00-b000-0000000a0004','b0700000-0000-4000-a000-000000000006','comercial',
   'Reunião de fechamento – Escritório Horizonte','c778374f-293b-44a5-a00f-dfc3777211a1','Escritório Horizonte',
   '43ef8386-3262-4e56-b31a-6f0e41d1e21c','Responsável Demo',
   CURRENT_DATE, '15:00','16:00','confirmado',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','06b27dbc-a668-4682-9066-f19eefc728a2',
     'oportunidade_titulo','Piso vinílico – Escritório Horizonte','local','Sede PS Gestão (Demo)'),
   'Fechamento do contrato do piso vinílico. Levar minuta e cronograma.','Sede PS Gestão (Demo)'),

  -- 5) futuro próximo · agendado — medição marcada
  ('d1111111-0006-4a00-b000-0000000a0005','b0700000-0000-4000-a000-000000000006','comercial',
   'Medição no local – Residencial Vista Verde','0c3c6dcb-95da-4e8f-bc3c-a5453159196d','Residencial Vista Verde',
   '666fca82-fefb-4a7c-bf35-89463a587e6b','Responsável Demo',
   CURRENT_DATE + 2, '10:00','11:30','agendado',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','3c4d4e22-4e07-4658-b1cc-b14deec95922',
     'oportunidade_titulo','Forro e divisórias – Residencial Vista Verde','local','Obra – bloco B'),
   'Medição de forro e divisórias do bloco B para orçamento.','Obra – bloco B'),

  -- 6) futuro · agendado — visita comercial marcada
  ('d1111111-0006-4a00-b000-0000000a0006','b0700000-0000-4000-a000-000000000006','comercial',
   'Visita comercial – Clínica Bem Viver','88b284c5-b1d2-49d3-a75e-f63c99e90c5d','Clínica Bem Viver',
   '33464170-036f-4d3b-bc48-f2dc3dfde660','Responsável Demo',
   CURRENT_DATE + 6, '16:00','17:00','agendado',
   jsonb_build_object('seed','pdca-agenda-15981a26','oportunidade_id','5a0e4c6e-38ee-4485-a1c6-8f279a14bdb9',
     'oportunidade_titulo','Divisórias e forro – Clínica Bem Viver','local','Clínica Bem Viver'),
   'Apresentar opções de divisórias e forro acústico para as salas de atendimento.','Clínica Bem Viver')
ON CONFLICT (id) DO NOTHING;
