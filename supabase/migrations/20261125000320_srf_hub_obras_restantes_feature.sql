-- PDCA Hub · RD-35 · liga as telas restantes do Hub Projetos às suas features (screen_route_features)
-- Code: jordana-code
--
-- Problema (sistema_rd35): rotas catalogadas em system_screens, alcançáveis, mas SEM feature ligada (n=0).
-- RD-35 acusa "virou pronta mas sem feature linkada". Cada tela liga à feature do seu domínio:
--   /dashboard/projetos/takeoff             ("Takeoff · Medição de plantas") -> feat_projetos_takeoff  ("Takeoff IA (Planta)")
--   /dashboard/projetos/visitas             ("Visitas Tecnicas")             -> crm_visitas_telas       ("CRM · Visitas Tecnicas")
--   /dashboard/projetos/cockpit             ("Cockpit (escolher obra)")      -> feat_projetos_obras     (família Obras)
--   /dashboard/projetos/acompanhamento      ("Acompanhamento Obras")         -> feat_projetos_obras
--   /dashboard/projetos/obras               ("Obras (lista)")                -> feat_projetos_obras
--   /dashboard/projetos/obras/os            ("Ordens de serviço de obra")    -> feat_projetos_obras
--   /dashboard/projetos/obras/resultado     ("Resultado por obra")           -> feat_projetos_obras
--   /dashboard/projetos/obras/[id]/cronograma ("Cronograma da obra")         -> feat_projetos_obras
--
-- Aditivo e idempotente (UNIQUE (screen_id, feature_id) → ON CONFLICT DO NOTHING); screen_id resolvido pela
-- ROTA (independe do UUID por ambiente), peso 1.0, visibilidade 'primary'. Não toca núcleo, RLS, menu nem
-- dado de cliente. As features existem em feature_catalog (conferido); FK garante integridade.
--
-- RD-38 (produção): ANTES n_feat=0 nas 8 rotas; DEPOIS n_feat=1 com a feature correspondente; re-run não duplica.

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, m.feature_id, 1.0, 'primary'
FROM (VALUES
  ('/dashboard/projetos/takeoff',               'feat_projetos_takeoff'),
  ('/dashboard/projetos/visitas',               'crm_visitas_telas'),
  ('/dashboard/projetos/cockpit',               'feat_projetos_obras'),
  ('/dashboard/projetos/acompanhamento',        'feat_projetos_obras'),
  ('/dashboard/projetos/obras',                 'feat_projetos_obras'),
  ('/dashboard/projetos/obras/os',              'feat_projetos_obras'),
  ('/dashboard/projetos/obras/resultado',       'feat_projetos_obras'),
  ('/dashboard/projetos/obras/[id]/cronograma', 'feat_projetos_obras')
) AS m(rota, feature_id)
JOIN public.system_screens s ON s.rota = m.rota
ON CONFLICT (screen_id, feature_id) DO NOTHING;
