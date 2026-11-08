-- RD-35 · vincular as sub-rotas do cockpit da obra à feature "Obras" (feat_projetos_obras)
-- via screen_route_features + system_screens.features_relacionadas.
--
-- Contexto: o trigger tg_alerta_tela_orfa dispara quando uma tela vira 'pronto'/'parcial'
-- sem linha em screen_route_features (screen_id). Em 08/11 (sistema_rd35) as 6 sub-rotas do
-- cockpit da obra entraram em system_screens (#4089) mas ficaram SEM feature linkada — alertas
-- "Tela ... virou pronta mas sem feature linkada" (encerramento, subempreiteiros, revisões,
-- linha do tempo, relatório e medições). Todas são facetas da feature "Obras" (feat_projetos_obras).
--
-- RD-38 (provado em BEGIN...ROLLBACK na produção, tabelas pequenas, sem varredura):
--   1ª aplicação -> 6 vínculos inseridos e 6 features_relacionadas preenchidas;
--   2ª aplicação -> 0 (idempotente).
-- 100% ADITIVO / IDEMPOTENTE: só catálogo de telas; nenhum INSERT/UPDATE/DELETE de dado de cliente.

-- 1) Vínculo tela ↔ feature (RD-35). Idempotente via NOT EXISTS.
INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT s.id, 'feat_projetos_obras', 1, 'primary'
FROM public.system_screens s
WHERE s.rota IN (
  '/dashboard/projetos/obras/[id]/encerramento',
  '/dashboard/projetos/obras/[id]/subempreiteiros',
  '/dashboard/projetos/obras/[id]/revisoes',
  '/dashboard/projetos/obras/[id]/linha-do-tempo',
  '/dashboard/projetos/obras/[id]/relatorio',
  '/dashboard/projetos/obras/[id]/medicoes')
  AND NOT EXISTS (
    SELECT 1 FROM public.screen_route_features srf
    WHERE srf.screen_id = s.id AND srf.feature_id = 'feat_projetos_obras');

-- 2) Espelha o vínculo em system_screens.features_relacionadas (RD-98 p3, origem do dado). Idempotente.
UPDATE public.system_screens
   SET features_relacionadas = ARRAY['feat_projetos_obras']::text[],
       atualizado_em = now()
 WHERE rota IN (
  '/dashboard/projetos/obras/[id]/encerramento',
  '/dashboard/projetos/obras/[id]/subempreiteiros',
  '/dashboard/projetos/obras/[id]/revisoes',
  '/dashboard/projetos/obras/[id]/linha-do-tempo',
  '/dashboard/projetos/obras/[id]/relatorio',
  '/dashboard/projetos/obras/[id]/medicoes')
   AND (features_relacionadas IS NULL
        OR NOT (features_relacionadas @> ARRAY['feat_projetos_obras']::text[]));
