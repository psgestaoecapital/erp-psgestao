-- PDCA GE (auditor_pdca_2) · /dashboard/financeiro/renegociacao
-- GAP: duas linhas ATIVAS em module_catalog apontam para a MESMA rota:
--   (a) financeiro_renegociacao · grupo=gestao_empresarial · is_shared=true · ordem=25 (CANÔNICA)
--   (b) pm_fin_renegociacao     · grupo=pm · is_shared=false · ordem=118 (DUPLICATA, criada 2026-11-04)
-- Uma tela de NÚCLEO compartilhado não deve ter cópia de item de menu por vertical. O padrão é
-- cross-surfacing: manter só a canônica e, para o menu PM exibir, usar surface_in_groups=['pm']
-- na própria linha canônica — NUNCA uma 2ª linha. (fn_modulos_sidebar_por_area: a 2ª UNION
-- surfaça is_shared=true com surface_in_groups @> [p_area_id] e grupo != p_area_id.)
--
-- Aditiva/idempotente. Não deleta: a duplicata tem 3 refs em plan_modules (FK) — desativar
-- (ativo=false, legacy=true) tira do menu nas DUAS branches (ambas exigem ativo=true) e preserva a FK.
-- module_catalog é dado de SISTEMA (não de cliente).

-- 1) canônica aparece no menu PM via cross-surfacing (sem 2ª linha)
UPDATE public.module_catalog
SET surface_in_groups = ARRAY(SELECT DISTINCT unnest(COALESCE(surface_in_groups, '{}'::text[]) || ARRAY['pm']))
WHERE id = 'financeiro_renegociacao'
  AND NOT (COALESCE(surface_in_groups, '{}'::text[]) @> ARRAY['pm']);

-- 2) desativa a duplicata de vertical (reversível, FK plan_modules preservada)
UPDATE public.module_catalog
SET ativo = false, legacy = true
WHERE id = 'pm_fin_renegociacao'
  AND rota = '/dashboard/financeiro/renegociacao';

-- Prova RD-38 (roda na aplicação; não altera o resultado):
--   SELECT count(*) FILTER (WHERE ativo) FROM public.module_catalog
--   WHERE rota='/dashboard/financeiro/renegociacao';  -- deve voltar 1
DO $$
DECLARE v_ativos int;
BEGIN
  SELECT count(*) FILTER (WHERE ativo) INTO v_ativos
  FROM public.module_catalog WHERE rota = '/dashboard/financeiro/renegociacao';
  IF v_ativos <> 1 THEN
    RAISE EXCEPTION 'PDCA renegociacao: esperado 1 linha ativa na rota, encontrado %', v_ativos;
  END IF;
END $$;
