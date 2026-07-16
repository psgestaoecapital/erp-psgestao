-- SEED DE DEMO — P&M · PDOIS (36b69d77-b4ea-414b-8519-2ff6621c8de7) — apresentação.
-- ⚠️ NÃO é migração (não roda em todo ambiente): é seed de dado marcado [DEMO], idempotente e removível.
-- Rodar via MCP/execute_sql. Escopo por company_id (multi-tenant). Zero dado real de cliente.
-- Remover depois: DELETE ... WHERE company_id=<pdois> AND (nome/titulo) LIKE '[DEMO]%' (ordem FK-safe abaixo).

DO $$
DECLARE
  C uuid := '36b69d77-b4ea-414b-8519-2ff6621c8de7';
  cli_otica uuid; cli_rest uuid; prop uuid; contr uuid; job1 uuid; comp date := '2026-07-01';
BEGIN
  -- limpeza idempotente (só [DEMO], ordem FK-safe)
  DELETE FROM agency_comissao WHERE company_id=C AND job_id IN (SELECT id FROM agency_jobs WHERE company_id=C AND titulo LIKE '[DEMO]%');
  DELETE FROM agency_jobs WHERE company_id=C AND titulo LIKE '[DEMO]%';
  DELETE FROM agency_contratos WHERE company_id=C AND cliente_id IN (SELECT id FROM agency_clientes WHERE company_id=C AND nome LIKE '[DEMO]%');
  DELETE FROM agency_propostas WHERE company_id=C AND titulo LIKE '[DEMO]%';
  DELETE FROM agency_leads WHERE company_id=C AND nome LIKE '[DEMO]%';
  DELETE FROM agency_clientes WHERE company_id=C AND nome LIKE '[DEMO]%';

  INSERT INTO agency_clientes (company_id, nome, nome_fantasia, segmento, fee_mensal, tipo_contrato, status, unidade, data_inicio)
    VALUES (C,'[DEMO] Ótica Central','Ótica Central','Varejo óptico',2500,'recorrente','ativo','Matriz','2026-05-01') RETURNING id INTO cli_otica;
  INSERT INTO agency_clientes (company_id, nome, nome_fantasia, segmento, fee_mensal, tipo_contrato, status, unidade, data_inicio)
    VALUES (C,'[DEMO] Restaurante Sabor','Restaurante Sabor','Food service',1800,'recorrente','ativo','Unidade Centro','2026-06-01') RETURNING id INTO cli_rest;

  INSERT INTO agency_leads (company_id, nome, empresa, origem, canal_contato, etapa, valor_estimado, reuniao_agendada_em)
    VALUES (C,'[DEMO] Academia Corpo','Academia Corpo Ltda','trafego_pago','whatsapp','proposta',3200,'2026-07-14 15:00-03');

  INSERT INTO agency_propostas (company_id, cliente_id, numero, titulo, descricao, itens, valor_total, valor_final, condicao_pagamento, status, data_envio, data_aprovacao)
    VALUES (C, cli_otica, 'PROP-DEMO-001','[DEMO] Gestão de redes + tráfego','Social media + tráfego pago mensal',
      '[{"item":"Social media","valor":1500},{"item":"Tráfego pago","valor":1000}]'::jsonb,
      2500, 2500, 'Mensal', 'aprovada', '2026-07-01', '2026-07-03') RETURNING id INTO prop;

  INSERT INTO agency_contratos (company_id, cliente_id, proposta_id, tipo, fee_mensal, dia_vencimento, data_inicio, status, documentacao_ok)
    VALUES (C, cli_otica, prop, 'recorrente', 2500, 10, '2026-07-01', 'ativo', true) RETURNING id INTO contr;

  INSERT INTO agency_jobs (company_id, cliente_id, numero, titulo, tipo, status, prioridade, valor_job, custo_estimado, horas_estimadas, horas_realizadas, percentual_comissao, data_prazo)
    VALUES (C, cli_otica, 'JOB-DEMO-001','[DEMO] Campanha Dia dos Pais','social','em_producao','alta',1800,600,20,12,10,'2026-07-25') RETURNING id INTO job1;
  INSERT INTO agency_jobs (company_id, cliente_id, numero, titulo, tipo, status, prioridade, valor_job, custo_estimado, horas_estimadas, horas_realizadas, percentual_comissao, data_prazo)
    VALUES (C, cli_rest, 'JOB-DEMO-002','[DEMO] Cardápio novo + fotos','design','em_aprovacao','media',1200,400,15,14,8,'2026-07-20');
  INSERT INTO agency_jobs (company_id, cliente_id, numero, titulo, tipo, status, prioridade, valor_job, custo_estimado, horas_estimadas, horas_realizadas, percentual_comissao, data_prazo)
    VALUES (C, cli_otica, 'JOB-DEMO-003','[DEMO] Post institucional julho','social','publicado','baixa',600,150,6,6,10,'2026-07-10');

  INSERT INTO agency_comissao (company_id, job_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status)
    VALUES (C, job1, NULL, 1800, 10, 180, comp, 'prevista');
END $$;
