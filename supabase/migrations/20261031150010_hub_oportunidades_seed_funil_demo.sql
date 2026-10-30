-- Hub · /dashboard/projetos/oportunidades 93 -> 95 (aud8 30/10, caixa 28a2b1c5 · Code: dev7claudeps)
-- RD-98 p1 (sem tela morta): o funil da DEMO do Hub tinha cards só em algumas etapas; "Orçando", "Visita feita"
-- e "Perdido" ficavam vazias. Semeia 2-3 cards por etapa na Construtora Modelo - DEMO, com valores e clientes reais da demo.
-- ADITIVA e IDEMPOTENTE: só INSERT, chaveado por (empresa, título) — rodar de novo não duplica. Só empresa DEMO.
-- NOTA (RD-38): a mensagem citava b0700000-...-0004 como "FC-PISOS", mas no banco ela é "Comércio (GE) - DEMO"; a
-- FC PISOS real (b202b50f-...) é cliente de verdade e NUNCA é tocada. A DEMO do Hub é a ...0006.
INSERT INTO public.erp_crm_oportunidade
  (company_id, cliente_id, titulo, etapa, valor_estimado, valor_proposta, probabilidade, origem,
   data_prevista_fechamento, data_fechamento, motivo_perda, ordem, responsavel_nome, created_at, updated_at)
SELECT c.id, k.id, s.titulo, s.etapa, s.valor, s.valor_prop, s.prob, 'indicacao',
       s.prev, s.fech, s.motivo, 1, 'Responsável Demo',
       now() - (s.dias || ' days')::interval, now() - (s.dias || ' days')::interval
  FROM public.companies c
  JOIN (VALUES
    ('Piso epóxi – Galpão Logístico Norte',        'prospeccao',       68000, NULL::numeric, 15, 'Escritório Horizonte',     DATE '2026-12-15', NULL::date,       NULL::text, 3),
    ('Revestimento cozinha industrial – Mercado',  'prospeccao',       37500, NULL,          20, 'Mercado Central Demo',     DATE '2026-12-20', NULL,             NULL,       2),
    ('Pintura e forro – Clínica Bem Viver fase 2', 'visita_agendada',  52000, NULL,          30, 'Clínica Bem Viver',        DATE '2026-12-05', NULL,             NULL,       2),
    ('Piso polido – Escritório Horizonte',         'visita_feita',     73000, NULL,          40, 'Escritório Horizonte',     DATE '2026-11-28', NULL,             NULL,       4),
    ('Impermeabilização laje – Vista Verde',       'visita_feita',     29500, NULL,          45, 'Residencial Vista Verde',  DATE '2026-11-25', NULL,             NULL,       5),
    ('Reforma de fachada – Frigorífico Oeste',     'orcando',         118000, NULL,          50, 'Frigorífico Oeste (Demo)', DATE '2026-11-22', NULL,             NULL,       6),
    ('Divisórias e forro – Clínica Bem Viver',     'orcando',          46000, NULL,          55, 'Clínica Bem Viver',        DATE '2026-11-18', NULL,             NULL,       8),
    ('Piso industrial – Frigorífico Oeste ampliação','proposta_enviada',210000, 198500,      65, 'Frigorífico Oeste (Demo)', DATE '2026-11-26', NULL,             NULL,       4),
    ('Pintura predial – Residencial Vista Verde',  'negociacao',       87000, 82300,         75, 'Residencial Vista Verde',  DATE '2026-11-15', NULL,             NULL,       3),
    ('Revestimento fachada – Mercado Central',     'ganho',            64000, 61200,        100, 'Mercado Central Demo',     DATE '2026-10-20', DATE '2026-10-20', NULL,      9),
    ('Piso vinílico – Escritório Horizonte',       'perdido',          39000, 37000,          0, 'Escritório Horizonte',     DATE '2026-10-12', DATE '2026-10-12', 'Preço acima do concorrente', 18),
    ('Reforma sanitários – Clínica Bem Viver',     'perdido',          22000, NULL,           0, 'Clínica Bem Viver',        DATE '2026-10-08', DATE '2026-10-08', 'Cliente adiou a obra',        22)
  ) AS s(titulo, etapa, valor, valor_prop, prob, cliente, prev, fech, motivo, dias) ON true
  JOIN public.erp_clientes k ON k.company_id = c.id AND COALESCE(k.nome_fantasia, k.razao_social) = s.cliente
 WHERE c.id = 'b0700000-0000-4000-a000-000000000006'::uuid
   AND c.nome_fantasia ILIKE '%DEMO%'
   AND NOT EXISTS (SELECT 1 FROM public.erp_crm_oportunidade o
                    WHERE o.company_id = c.id AND o.titulo = s.titulo AND o.deleted_at IS NULL);
