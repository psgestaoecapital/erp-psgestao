-- Hub · Agenda comercial (/dashboard/projetos/agenda) — SEED DEMO "Minha agenda" (aud8 90/95, PDCA agenda item 3)
--
-- CONTEXTO (aud8 27/11, prova RD-38): a DEMO 006 já tem 6 agendamentos comerciais (seed 20261123004040),
-- mas TODOS têm responsavel_id de "Responsável Demo" — NENHUM é do usuário logado da demonstração
-- (screenshot@psgestao.com, id 74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa). A aba PADRÃO "Minha agenda"
-- filtra responsavel_id = usuário logado (AgendaComercialView: `responsavel_id.eq.{uid}` OU
-- `responsavel_id IS NULL AND created_by = {uid}`), então ela abria a semana INTEIRA vazia na demo do Hub.
-- Medido: 0 agendamentos ativos com responsavel_id = esse usuário na empresa 006.
-- O item 1 (estado-vazio orientativo AgendaVazia) já entrou na #6412; este item 3 POPULA a "Minha agenda".
--
-- AÇÃO: só dado de DEMO (RD-69/LGPD — fictício), aditivo e idempotente. Nenhuma mudança de tela/função/RLS.
-- Semeia 2 compromissos do PRÓPRIO usuário da demo, ANCORADOS À SEMANA CORRENTE (date_trunc('week')),
-- para a "Minha agenda" abrir SEMPRE populada na semana exibida, em qualquer dia que a demo rodar (evergreen).
-- Vincula a clientes/oportunidades DEMO JÁ EXISTENTES; status válidos do AgendaComercialView (confirmado/agendado).
--
-- IDEMPOTÊNCIA: ids fixos (série 'b') + ON CONFLICT (id) DO NOTHING. Re-rodar não duplica.
-- SEGURANÇA: só INSERT na empresa DEMO 006 (b0700000-…-006); não toca dado de cliente real nem RLS/função.

INSERT INTO public.erp_agendamento
  (id, company_id, origem_modulo, titulo, cliente_id, cliente_nome,
   responsavel_id, responsavel_nome, created_by, data, hora_inicio, hora_fim, status, dados, observacao, local)
VALUES
  -- 1) MEIO DA SEMANA CORRENTE (quarta) · confirmado — compromisso do usuário logado
  ('d1111111-0006-4a00-b000-0000000b0001','b0700000-0000-4000-a000-000000000006','comercial',
   'Reunião de proposta – Clínica Bem Viver','88b284c5-b1d2-49d3-a75e-f63c99e90c5d','Clínica Bem Viver',
   '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa','Consultor(a) Comercial (Demo)','74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa',
   (date_trunc('week', CURRENT_DATE)::date + 2), '09:30','10:30','confirmado',
   jsonb_build_object('seed','pdca-agenda-minha-b0f2','oportunidade_id','9d6ef363-19a2-41b3-a511-da9d047bf03f',
     'oportunidade_titulo','Reforma sanitários – Clínica Bem Viver','local','Sede PS Gestão (Demo)'),
   'Apresentar a proposta revisada da reforma dos sanitários e alinhar prazos.','Sede PS Gestão (Demo)'),

  -- 2) FIM DA SEMANA CORRENTE (sexta) · agendado — visita do usuário logado
  ('d1111111-0006-4a00-b000-0000000b0002','b0700000-0000-4000-a000-000000000006','comercial',
   'Visita comercial – Escritório Horizonte','c778374f-293b-44a5-a00f-dfc3777211a1','Escritório Horizonte',
   '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa','Consultor(a) Comercial (Demo)','74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa',
   (date_trunc('week', CURRENT_DATE)::date + 4), '14:00','15:00','agendado',
   jsonb_build_object('seed','pdca-agenda-minha-b0f2','oportunidade_id','06b27dbc-a668-4682-9066-f19eefc728a2',
     'oportunidade_titulo','Piso vinílico – Escritório Horizonte','local','Escritório Horizonte'),
   'Medir as salas e fechar o escopo do piso vinílico com o cliente.','Escritório Horizonte')
ON CONFLICT (id) DO NOTHING;
