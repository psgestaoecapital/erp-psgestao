-- ONDA 1 INUNDACAO (CEO 27/05/2026 · tag onda_1_backend_pronto)
-- Aplicado via MCP apply_migration · rastreio histórico.
--
-- Frente 1: remove "COMPARTILHADO" (commerce items) do menu GE.
-- Esses módulos (Estoque Movimentado, OTC Order-to-Cash, Fichas Técnicas)
-- pertencem à área Commerce. Apareciam na área GE como "COMPARTILHADO"
-- porque tinham 'gestao_empresarial' em surface_in_groups · removido.

UPDATE module_catalog
SET surface_in_groups = array_remove(surface_in_groups, 'gestao_empresarial')
WHERE id IN ('commerce_estoque_movimento', 'commerce_otc', 'commerce_fichas_tecnicas');
