-- Chamado #3338 (Code-Auditor): /dashboard/projetos/visitas mostrava lista vazia na DEMO.
-- Causa verificada (RD-38): a Construtora Modelo - DEMO tinha 0 linhas em erp_crm_visita
-- (a consulta e a RLS estão corretas). Semente aditiva e idempotente, só na DEMO, dados fictícios.
-- Plano de volta (RD-97): DELETE FROM erp_crm_visita WHERE id IN (os 4 ids abaixo).
INSERT INTO public.erp_crm_visita
  (id, company_id, oportunidade_id, data_visita, status, endereco, anotacoes, responsavel_nome)
SELECT v.id::uuid, 'b0700000-0000-4000-a000-000000000006'::uuid, v.op::uuid,
       now() + v.delta, v.st, v.ender, v.nota, 'Equipe DEMO'
FROM (VALUES
  ('b0700000-0000-4000-a000-0000000d0101','2d7fc0de-29b7-4889-ac3c-ae7194afde4c', interval '-6 days','realizada','Rua das Acácias, 120 - Vista Verde','Medidas conferidas; forro em 3 ambientes e divisória na sala.'),
  ('b0700000-0000-4000-a000-0000000d0102','85a3a57d-48e9-46ef-bfa9-76eeeba24746', interval '-2 days','realizada','Av. Central, 450 - Clínica Bem Viver','Piso com preparo de contrapiso; pintura em duas demãos.'),
  ('b0700000-0000-4000-a000-0000000d0103','8b54d6af-ff70-4d0d-b361-47d4738aded1', interval '2 days','agendada','Rua do Comércio, 77 - Horizonte','Levar trena a laser; confirmar pé-direito.'),
  ('b0700000-0000-4000-a000-0000000d0104','52cdce3c-ce20-41a3-afd3-976f7947c9cc', interval '-9 days','cancelada','Praça do Mercado, 10 - Mercado Central','Cliente remarcou; reagendar.')
) AS v(id, op, delta, st, ender, nota)
WHERE EXISTS (SELECT 1 FROM public.erp_crm_oportunidade o
              WHERE o.id = v.op::uuid AND o.company_id = 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (id) DO NOTHING;
