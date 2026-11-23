-- PDCA Hub · RD-35 · liga 3 telas do Hub Projetos às suas features (screen_route_features)
-- Code: jordana-code
--
-- Problema (sistema_rd35, 21-22/11): rotas catalogadas em system_screens, alcançáveis, mas SEM feature
-- ligada (n=0). RD-35 acusa "virou pronta mas sem feature linkada". Cada tela liga à feature da sua
-- página-mãe/lista (mesma receita das irmãs já ligadas):
--   /dashboard/projetos/catalogo/[id]  ("Detalhe Serviço")  -> F.hub.projetos_catalogo  (lista /catalogo já usa) · 0ed3633e
--   /dashboard/projetos/obras/nova     ("Nova obra")         -> feat_projetos_obras       (família Obras)         · 07ce8de2
--   /dashboard/projetos/propostas      ("Orçamentos (Hub)")  -> feat_projetos_propostas   (feature "Orçamentos")  · 2e31fec9
--
-- Aditivo e idempotente (UNIQUE (screen_id, feature_id) → ON CONFLICT DO NOTHING); screen_id resolvido pela
-- ROTA (independe do UUID por ambiente), peso 1.0, visibilidade 'primary'. Não toca núcleo, RLS, menu nem
-- dado de cliente. As 3 features existem em feature_catalog (conferido); FK garante integridade.
--
-- RD-38 (produção): ANTES n_feat=0 nas 3 rotas; DEPOIS n_feat=1 com a feature correspondente; re-run não duplica.

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, m.feature_id, 1.0, 'primary'
FROM (VALUES
  ('/dashboard/projetos/catalogo/[id]', 'F.hub.projetos_catalogo'),
  ('/dashboard/projetos/obras/nova',    'feat_projetos_obras'),
  ('/dashboard/projetos/propostas',     'feat_projetos_propostas')
) AS m(rota, feature_id)
JOIN public.system_screens s ON s.rota = m.rota
ON CONFLICT (screen_id, feature_id) DO NOTHING;
