-- FIX-CICLO-COMERCIO (07/07 · CEO autorizado):
-- Religar telas REAIS do ciclo (OTC, Fichas, Hub Fiscal, NFe/NFSe emitidas)
-- no menu da area gestao_empresarial. Antes:
--   - commerce_otc (Vendas/Faturamento/Pedido/Fatura) tinha surface_in_groups=[]
--     -> orfa em qualquer menu, so acessivel por URL direta
--   - commerce_nfe / commerce_nfse INATIVOS + rotas erradas
--     (/dashboard/commerce/nfe -- rota real vive em /dashboard/fiscal/*)
--   - commerce_fichas_tecnicas idem surface_in_groups=[]
--   - Hub Fiscal (screen /dashboard/fiscal) nao tinha modulo apontando pra rota
-- CEO reportou: "nao encontro a geracao de Pedido C37808909"
-- Causa: menu de "Vendas" mostrava so placeholders ge_prev_*
--        (paginas 'previsto' sem funcionalidade); OTC real ficou orfa.
-- Aplicada via MCP apply_migration em 2026-07-06 (success:true).

-- =====================================================
-- Fix 1 · religar OTC (Orcamento/Pedido/Faturamento) no menu GE
-- =====================================================
UPDATE public.module_catalog
SET surface_in_groups = ARRAY['gestao_empresarial'],
    subgrupo = 'vendas'
WHERE id = 'commerce_otc';

-- Fichas Tecnicas idem (esta viva mas orfa)
UPDATE public.module_catalog
SET surface_in_groups = ARRAY['gestao_empresarial'],
    subgrupo = 'cadastros'
WHERE id = 'commerce_fichas_tecnicas';

-- =====================================================
-- Fix 2 · Fiscal: NFe/NFSe emitidas + Hub Fiscal
-- =====================================================
UPDATE public.module_catalog
SET ativo = false
WHERE id IN ('commerce_nfe', 'commerce_nfse');

INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ativo, surface_in_groups)
VALUES
  ('fiscal_hub', 'Hub Fiscal', '/dashboard/fiscal', 'gestao_empresarial', 'notas_fiscais', true, ARRAY['gestao_empresarial']),
  ('fiscal_nfe_emitidas', 'NFes Emitidas', '/dashboard/fiscal/nfe', 'gestao_empresarial', 'notas_fiscais', true, ARRAY['gestao_empresarial']),
  ('fiscal_nfse_emitidas', 'NFSes Emitidas', '/dashboard/fiscal/nfse', 'gestao_empresarial', 'notas_fiscais', true, ARRAY['gestao_empresarial'])
ON CONFLICT (id) DO UPDATE
SET ativo = EXCLUDED.ativo,
    rota = EXCLUDED.rota,
    grupo = EXCLUDED.grupo,
    subgrupo = EXCLUDED.subgrupo,
    surface_in_groups = EXCLUDED.surface_in_groups;

-- =====================================================
-- Vincular os modulos religados ao plano GE Pro
-- =====================================================
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT 'v15_gestao_empresarial_pro', mid, true
FROM (VALUES
  ('commerce_otc'),
  ('commerce_fichas_tecnicas'),
  ('fiscal_hub'),
  ('fiscal_nfe_emitidas'),
  ('fiscal_nfse_emitidas')
) v(mid)
ON CONFLICT DO NOTHING;

-- =====================================================
-- Verificacao empirica: fn_modulos_sidebar_por_area para Gean pos-fix
-- =====================================================
--   VENDAS agora inclui:
--     - Vendas / Faturamento -> /dashboard/commerce/otc (real, era orfa)
--     - Ordens de Servico    -> /dashboard/os
--     - 4 placeholders ge_prev_*
--   NOTAS FISCAIS agora inclui:
--     - Hub Fiscal        -> /dashboard/fiscal
--     - NFes Emitidas     -> /dashboard/fiscal/nfe
--     - NFSes Emitidas    -> /dashboard/fiscal/nfse
--     - 4 placeholders ge_prev_*
--   CADASTROS agora inclui:
--     - Fichas Tecnicas   -> /dashboard/commerce/fichas
