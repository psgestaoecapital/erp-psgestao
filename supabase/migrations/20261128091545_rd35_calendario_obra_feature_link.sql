-- RD-35 · liga a tela "Calendário da obra" (tela 109, /dashboard/projetos/obras/[id]/calendario)
-- à sua feature em screen_route_features. O alerta RD-35 do briefing (26/11) apontou:
-- "Tela 'Calendário da obra' virou pronta mas sem feature linkada ... Acao: linkar a
-- feature_catalog via screen_route_features". As 20 telas irmãs /dashboard/projetos/obras/[id]/*
-- já ligam à feature 'feat_projetos_obras' (peso 1, visibilidade 'primary'); esta ligação faltava.
--
-- ADITIVA e IDEMPOTENTE: só insere se a tela existir em system_screens, a feature existir em
-- feature_catalog e a ligação ainda não existir. Prova RD-38 (BEGIN..ROLLBACK em produção, 26/11):
-- antes 0 ligações para o screen_id; após 1ª aplicação = 1; após 2ª (idempotência) = 1; feature
-- ligada = feat_projetos_obras. Não toca dado de cliente, RLS, permissão ou função.
INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, 'feat_projetos_obras', 1, 'primary'
FROM public.system_screens s
WHERE s.rota = '/dashboard/projetos/obras/[id]/calendario'
  AND EXISTS (SELECT 1 FROM public.feature_catalog WHERE id = 'feat_projetos_obras')
  AND NOT EXISTS (
    SELECT 1 FROM public.screen_route_features srf
    WHERE srf.screen_id = s.id AND srf.feature_id = 'feat_projetos_obras'
  );
