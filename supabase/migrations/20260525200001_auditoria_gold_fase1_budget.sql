-- AUDITORIA GOLD FASE 1 · budget control apertado
-- Aplicado via MCP apply_migration 25/05/2026 ~20:00 BRT
-- Cristalização foundational: erp_contexto_projeto id dfa2278d
-- Baseline pré-FASE 1: erp_contexto_projeto id bb817a70

UPDATE anthropic_budget_control
SET limite_max_custo_usd_dia = 5.00,
    limite_max_telas_por_execucao = 15,
    atualizado_em = NOW()
WHERE id = 1;

INSERT INTO erp_contexto_projeto (
  projeto, categoria, prioridade, status, titulo, descricao, refs, tags, criado_por
) VALUES (
  'erp_psgestao', 'decisao', 'critica', 'ativo',
  'AUDITORIA GOLD FASE 1 · budget control apertado',
  'Budget Anthropic apertado: USD 10 -> USD 5 / dia. Telas/exec: 30 -> 15. Aplicado 25/05/2026 via MCP apply_migration.',
  jsonb_build_object('aplicado_em', NOW(), 'fase', 1, 'baseline_pre_id', 'bb817a70', 'cristalizacao_id', 'dfa2278d'),
  ARRAY['auditoria_gold', 'fase_1', 'budget_apertado'],
  'code_web'
);
