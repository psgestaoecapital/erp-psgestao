-- PDCA PM · /dashboard/pm/importar-sistema-anterior (aud8 80/95) + RD-100 (CEO 01/11).
-- Problema (RD-38): as 6 chaves de ajuda da tela de importacao do P&M continuavam com
--   rota = '/dashboard/pm/importar-siga' (rota antiga, renomeada por RD-100 para
--   '/dashboard/pm/importar-sistema-anterior'). Como fn_ajuda_campo_listar filtra por rota
--   (WHERE c.rota = p_rota), os "?" (AjudaCampo) da tela abriam VAZIOS ("A ajuda deste campo
--   ainda nao foi escrita"), violando RD-95 na tela inteira.
-- Correcao (ADITIVA, idempotente, nao toca dado de cliente):
--   1) repontar as 6 chaves para a rota nova;
--   2) RD-100: renomear o identificador interno pm.siga.* -> pm.importacao.* (nao visivel,
--      mas tira o nome do terceiro do identificador). Os textos visiveis (rotulo/o_que/etc.)
--      ja estavam genericos ("sistema anterior") por limpeza RD-100 anterior.
-- Prova RD-38 (lida no banco antes da PR): novo_rota_antes=0, serao_movidas=6, ja_novas=0
--   => depois: 6 campos publicados em '/dashboard/pm/importar-sistema-anterior'; mesma
--   contagem de linhas (6), nada criado/apagado.

-- 1) Copia de seguranca da parte alterada (chave+rota) ANTES da mudanca (RD-100, idempotente).
CREATE TABLE IF NOT EXISTS public.erp_ajuda_campo_bkp_rd100_pm_importacao (
  chave    text,
  rota     text,
  salvo_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_ajuda_campo_bkp_rd100_pm_importacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_ajuda_campo_bkp_rd100_pm_importacao FROM anon;

INSERT INTO public.erp_ajuda_campo_bkp_rd100_pm_importacao (chave, rota)
SELECT c.chave, c.rota
FROM public.erp_ajuda_campo c
WHERE c.chave LIKE 'pm.siga.%'
  AND NOT EXISTS (
    SELECT 1 FROM public.erp_ajuda_campo_bkp_rd100_pm_importacao b WHERE b.chave = c.chave
  );

-- 2) Repontar rota + renomear identificador (idempotente: so pega as linhas antigas;
--    apos rodar, nenhuma chave 'pm.siga.%' resta, entao re-rodar e no-op).
UPDATE public.erp_ajuda_campo c
SET chave = m.novo,
    rota  = '/dashboard/pm/importar-sistema-anterior'
FROM (VALUES
  ('pm.siga.arquivo',   'pm.importacao.arquivo'),
  ('pm.siga.mapa',      'pm.importacao.mapa'),
  ('pm.siga.previa',    'pm.importacao.previa'),
  ('pm.siga.conferir',  'pm.importacao.conferir'),
  ('pm.siga.importar',  'pm.importacao.importar'),
  ('pm.siga.historico', 'pm.importacao.historico')
) AS m(antigo, novo)
WHERE c.chave = m.antigo;
