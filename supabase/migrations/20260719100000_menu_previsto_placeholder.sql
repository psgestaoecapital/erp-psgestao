-- MENU · PREVISTO sem 404 (RD-33: roadmap fica visível) + RÉGUA permanente.
-- Causa-raiz do 404: fn_modulos_sidebar_por_area SINTETIZA a rota quando module_catalog.rota é NULL
--   (rota_raiz || '/' || replace(id, area||'_','')) → ex. /dashboard/oficina/whatsapp_ia (não existe → 404).
-- Fix (RD-26): item ativo SEM rota passa a apontar p/ o placeholder "Em construção" (/dashboard/em-construcao/<id>),
--   reusando o mesmo padrão do previsto/[slug]. A RPC deixa de sintetizar (rota não é mais NULL) e o
--   badge "Previsto" continua automático (status = COALESCE(feature_catalog.status,'previsto')).
-- 🚫 NÃO desativa nada (RD-33). NÃO altera a RPC (função em uso). Só dados + a régua.

-- 1 · itens de menu ATIVOS sem rota real → apontam p/ o placeholder (nada mais cai em 404 sintetizado)
UPDATE public.module_catalog
  SET rota = '/dashboard/em-construcao/' || id
  WHERE ativo = true AND (rota IS NULL OR btrim(rota) = '');

-- 2 · RÉGUA PERMANENTE (DB): item de menu ativo SEM rota → sintetiza rota morta (404 silencioso).
--     Nasce porque cadastrar módulo e criar a página são passos separados. Deve ficar SEMPRE vazia.
CREATE OR REPLACE VIEW public.v_menu_rota_ausente AS
  SELECT id AS modulo_id, nome, grupo, ordem
  FROM public.module_catalog
  WHERE ativo = true AND (rota IS NULL OR btrim(rota) = '')
  ORDER BY grupo, ordem;

COMMENT ON VIEW public.v_menu_rota_ausente IS
  'Régua anti-404: itens de menu ativos sem rota (a RPC sintetiza um caminho inexistente). Deve estar vazia.';
