-- PDCA Hub · RD-35 · liga as sub-telas de /dashboard/projetos/obras/[id]/* à feature Obras
-- Code: jordana-code
--
-- Problema (sistema_rd35, 21-22/11): estas rotas já estão catalogadas em system_screens e com jornada
-- alcançável pelo Cockpit da obra, mas seguem SEM feature ligada em screen_route_features (n=0). O RD-35
-- acusa "virou pronta mas sem feature linkada":
--   /dashboard/projetos/obras/[id]/orcamento            (7f1227df)
--   /dashboard/projetos/obras/[id]/orcamento/importar   (f0ee3316)
--   /dashboard/projetos/obras/[id]/estrutura            (3cdf0d0f)
--   /dashboard/projetos/obras/[id]/ficha                (3491ced5)
--   /dashboard/projetos/obras/[id]/regularizacao        (b2d1357d)
--
-- Fix: todas são sub-telas da OBRA e, como TODAS as irmãs já ligadas em /obras/[id]/* (cockpit, custos,
-- medições, rdo, relatório, cronograma...), pertencem à feature feat_projetos_obras ("Obras"), peso 1.0,
-- visibilidade 'primary'. Aditivo e idempotente (UNIQUE (screen_id, feature_id) → ON CONFLICT DO NOTHING);
-- screen_id resolvido pela ROTA (independe do UUID por ambiente). Não toca núcleo, RLS, menu nem dado de cliente.
-- NÃO inclui /obras/[id]/partes (tratada na PR #5866).
--
-- RD-38 (produção): ANTES n_feat=0 nas 5 rotas; DEPOIS n_feat=1 (feat_projetos_obras); re-run não duplica.
-- feat_projetos_obras existe em feature_catalog (conferido); FK garante integridade.

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, 'feat_projetos_obras', 1.0, 'primary'
FROM public.system_screens s
WHERE s.rota IN (
  '/dashboard/projetos/obras/[id]/orcamento',
  '/dashboard/projetos/obras/[id]/orcamento/importar',
  '/dashboard/projetos/obras/[id]/estrutura',
  '/dashboard/projetos/obras/[id]/ficha',
  '/dashboard/projetos/obras/[id]/regularizacao'
)
ON CONFLICT (screen_id, feature_id) DO NOTHING;
