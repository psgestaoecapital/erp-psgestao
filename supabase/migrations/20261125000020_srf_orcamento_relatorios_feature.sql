-- PDCA Hub · RD-35 · liga a tela "Relatórios do orçamento por EAP" à feature_catalog (screen_route_features)
-- Code: jordana-code
--
-- Problema (sistema_rd35 + auditor_pdca_1, 22/11): a rota /dashboard/projetos/obras/[id]/orcamento/relatorios
-- já está catalogada em system_screens (migration 20261124170335, code-desenvolvedor-3) e a jornada está VERDE,
-- mas segue SEM feature ligada em screen_route_features (count por screen_id = 0). O RD-35 acusa "virou pronta
-- mas sem feature linkada"; sem o vínculo a tela não aparece ligada ao módulo no mapa de features.
--
-- Fix: liga à mesma feature de TODAS as irmãs em /dashboard/projetos/obras/[id]/* — feat_projetos_obras
-- ("Obras"), peso 1.0, visibilidade 'primary' — exatamente como /orcamento (parent) e /relatorio já o fariam.
-- Aditivo e idempotente (UNIQUE (screen_id, feature_id) → ON CONFLICT DO NOTHING). Resolve o screen_id pela
-- ROTA (independe do UUID por ambiente). Não toca núcleo, RLS, menu nem dado de cliente.
--
-- RD-38 (produção, main com a tela já catalogada):
--   ANTES : SELECT count(*) screen_route_features do screen (rota acima) = 0
--   DEPOIS: = 1 (feature_id = feat_projetos_obras) ; re-run não duplica (ON CONFLICT).
-- feat_projetos_obras existe em feature_catalog (conferido); FK garante integridade.

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, 'feat_projetos_obras', 1.0, 'primary'
FROM public.system_screens s
WHERE s.rota = '/dashboard/projetos/obras/[id]/orcamento/relatorios'
ON CONFLICT (screen_id, feature_id) DO NOTHING;
