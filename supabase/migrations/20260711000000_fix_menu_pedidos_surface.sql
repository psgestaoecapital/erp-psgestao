-- ============================================================
-- FIX render do menu "Pedidos": o item não aparecia pra KGF (nem p/ ninguém
-- em oficina/gestão). Diagnóstico (fn_modulos_sidebar_por_area):
--   - BRANCH 1 exige área com id = grupo do módulo; NÃO existe área 'erp_ext'
--     → módulos erp_ext nunca surgem por BRANCH 1.
--   - BRANCH 2 (compartilhado) surge só nas áreas de surface_in_groups. O
--     Pedidos herdou ['services','pm'] do Orçamento — áreas que a KGF (oficina/
--     gestão_empresarial) não usa. Por isso não renderizava.
-- FIX: incluir as áreas reais onde Pedidos deve aparecer (oficina, gestão
-- empresarial + demais verticais que vendem). Provado via a RPC: passa a
-- retornar 'pedidos' para a KGF em oficina e gestao_empresarial.
-- ============================================================

UPDATE module_catalog
SET surface_in_groups = ARRAY['services','pm','oficina','gestao_empresarial','hub','medica','odonto']::text[]
WHERE id = 'pedidos';
