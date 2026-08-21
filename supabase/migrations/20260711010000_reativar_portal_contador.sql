-- ============================================================
-- Reativar o Portal do Contador (/dashboard/contador) no menu.
-- A tela é REAL e robusta (626 linhas: Plano de Contas RFB, classificação
-- contábil, DRE/fiscal/reforma por empresa, portal API keys+webhooks) e o
-- módulo já está vinculado a 24 planos (inclusive os 2 da KGF). Mas estava
-- ÓRFÃO do menu — MESMA raiz do Pedidos: não existe área 'contador' em
-- area_menu_config (BRANCH 1 não dispara) e surface_in_groups estava VAZIO
-- (BRANCH 2 não surfa). is_shared já era true; faltava só o surface.
--
-- FIX (dado, zero código): surface_in_groups nas verticais que têm contador +
-- subgrupo 'contabilidade' pra cair na seção "CONTABILIDADE" (em vez de
-- "COMPARTILHADO"). Provado via fn_modulos_sidebar_por_area: passa a retornar
-- 'contador' p/ a KGF em oficina e gestao_empresarial.
-- ============================================================

UPDATE module_catalog
SET surface_in_groups = ARRAY['gestao_empresarial','oficina','hub','services','medica','odonto']::text[],
    subgrupo = 'contabilidade'
WHERE id = 'contador';
