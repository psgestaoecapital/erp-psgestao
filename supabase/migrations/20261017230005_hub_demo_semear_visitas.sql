-- Chamado #3338 (Code-Auditor): a tela de Visitas da DEMO aparecia vazia porque a empresa
-- Construtora Modelo - DEMO tinha 0 linhas em erp_crm_visita (a listagem filtra por empresa e está correta).
-- Semente 100% fictícia, só na DEMO, idempotente (ids fixos + ON CONFLICT DO NOTHING).
-- Plano de volta (RD-97): DELETE FROM erp_crm_visita WHERE id IN (os 5 ids abaixo) — nada depende delas.
INSERT INTO erp_crm_visita (id, company_id, oportunidade_id, data_visita, status, endereco, anotacoes, fotos)
VALUES
  ('b0700000-0000-4000-a000-0000000a0001','b0700000-0000-4000-a000-000000000006','2d7fc0de-29b7-4889-ac3c-ae7194afde4c', now() - interval '6 days', 'realizada', 'Rua das Acácias, 120 - Vista Verde', 'Pé-direito 2,80 m; 3 ambientes; cliente quer forro de gesso e 2 divisórias.', '[]'::jsonb),
  ('b0700000-0000-4000-a000-0000000a0002','b0700000-0000-4000-a000-000000000006','85a3a57d-48e9-46ef-bfa9-76eeeba24746', now() - interval '3 days', 'realizada', 'Av. Central, 450 - Clínica Bem Viver', 'Medido piso da recepção e consultórios; remoção de piso antigo necessária.', '[]'::jsonb),
  ('b0700000-0000-4000-a000-0000000a0003','b0700000-0000-4000-a000-000000000006','8b54d6af-ff70-4d0d-b361-47d4738aded1', now() + interval '1 day', 'agendada', 'Rua do Comércio, 88 - sala 3', 'Levar trena a laser e catálogo de chapas.', '[]'::jsonb),
  ('b0700000-0000-4000-a000-0000000a0004','b0700000-0000-4000-a000-000000000006','52cdce3c-ce20-41a3-afd3-976f7947c9cc', now() + interval '3 days', 'agendada', 'Praça Central, 15 - Mercado Central', 'Reforma de loja: verificar instalações elétricas antes do forro.', '[]'::jsonb),
  ('b0700000-0000-4000-a000-0000000a0005','b0700000-0000-4000-a000-000000000006','13cc16f4-27b7-40d9-98f4-b4e88a226533', now() - interval '10 days', 'cancelada', 'Rua das Acácias, 120 - fase 2', 'Cliente adiou a fase 2; reagendar quando liberar o prédio.', '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
