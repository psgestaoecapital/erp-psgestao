-- Hub · /dashboard/projetos/oportunidades — funil da FC-PISOS (DEMO) vivo em TODAS as etapas (RD-98 p1, caixa 28a2b1c5).
-- Hoje só a 1ª etapa tem card (e são lixo de teste); as demais colunas e os KPIs (valor em aberto, ganhos, ticket, conversão) ficam em R$0.
-- Seed ADITIVO e idempotente: ids fixos + ON CONFLICT DO NOTHING; só a empresa DEMO FC-PISOS; não toca linha existente.
-- Clientes: os "Demo" já existentes da própria empresa (nenhum dado de cliente real).
WITH cli AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) rn
  FROM erp_clientes
  WHERE company_id = 'b0700000-0000-4000-a000-000000000004'
    AND COALESCE(nome_fantasia, razao_social) ILIKE '%demo%'
), seed(n, titulo, etapa, valor, prob, resp, prev, fech, motivo) AS (
  VALUES
   (1,'Piso epóxi autonivelante — galpão logístico','prospeccao',182000,20,'Equipe Comercial FC',current_date+60,NULL::date,NULL),
   (2,'Polimento de concreto — centro de distribuição','prospeccao',96500,20,'Equipe Comercial FC',current_date+75,NULL,NULL),
   (3,'Piso industrial de alta resistência — fábrica de bebidas','visita_agendada',248000,30,'Equipe Comercial FC',current_date+50,NULL,NULL),
   (4,'Recuperação de piso — supermercado','visita_agendada',74300,30,'Equipe Comercial FC',current_date+45,NULL,NULL),
   (5,'Piso em concreto armado — pátio de manobras','visita_feita',315000,40,'Equipe Comercial FC',current_date+40,NULL,NULL),
   (6,'Piso antiderrapante — frigorífico','visita_feita',129900,40,'Equipe Comercial FC',current_date+35,NULL,NULL),
   (7,'Piso epóxi — sala limpa farmacêutica','orcando',210400,50,'Equipe Comercial FC',current_date+30,NULL,NULL),
   (8,'Piso industrial — montadora (lote 2)','orcando',468000,50,'Equipe Comercial FC',current_date+28,NULL,NULL),
   (9,'Piso de alto tráfego — shopping','proposta_enviada',385000,60,'Equipe Comercial FC',current_date+21,NULL,NULL),
   (10,'Piso autonivelante — hospital (ala nova)','proposta_enviada',152700,60,'Equipe Comercial FC',current_date+18,NULL,NULL),
   (11,'Piso industrial — armazém frigorífico','negociacao',540000,80,'Equipe Comercial FC',current_date+10,NULL,NULL),
   (12,'Piso epóxi — cozinha industrial','negociacao',88200,80,'Equipe Comercial FC',current_date+7,NULL,NULL),
   (13,'Piso de concreto polido — showroom','ganho',176000,100,'Equipe Comercial FC',NULL,current_date-12,NULL),
   (14,'Piso industrial — centro logístico (fase 1)','ganho',422500,100,'Equipe Comercial FC',NULL,current_date-5,NULL),
   (15,'Piso antiderrapante — indústria de alimentos','ganho',134800,100,'Equipe Comercial FC',NULL,current_date-2,NULL),
   (16,'Piso epóxi — oficina mecânica','perdido',58900,0,'Equipe Comercial FC',NULL,current_date-9,'Preço acima do concorrente'),
   (17,'Recuperação de piso — escola','perdido',91300,0,'Equipe Comercial FC',NULL,current_date-20,'Obra adiada pelo cliente')
)
INSERT INTO erp_crm_oportunidade
  (id, company_id, cliente_id, titulo, etapa, valor_estimado, probabilidade, responsavel_nome,
   data_prevista_fechamento, data_fechamento, motivo_perda, ordem, origem, created_at, updated_at)
SELECT ('b0700000-0000-4000-a000-' || lpad((90000 + s.n)::text, 12, '0'))::uuid,
       'b0700000-0000-4000-a000-000000000004',
       (SELECT c.id FROM cli c WHERE c.rn = ((s.n - 1) % GREATEST((SELECT count(*) FROM cli), 1)) + 1),
       s.titulo, s.etapa, s.valor, s.prob, s.resp, s.prev, s.fech, s.motivo, s.n, 'demo',
       now() - make_interval(days => 20 - s.n), now() - make_interval(days => GREATEST(0, 10 - s.n))
FROM seed s
WHERE EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000004')
ON CONFLICT (id) DO NOTHING;
