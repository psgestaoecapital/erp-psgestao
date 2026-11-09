-- Hub · remove definitivamente o item de menu "Acompanhamento" (projetos_acompanhamento, ordem 131), que levava à
-- MESMA tela de "Resultado por obra" (projetos_resultado_obra, ordem 132) — a rota /dashboard/projetos/acompanhamento
-- é só um redirect de servidor para /dashboard/projetos/obras/resultado.
--
-- Gaps do auditor em /dashboard/projetos/acompanhamento:
--   (criterio e) dois itens de menu VIZINHOS abrem a mesma tela;
--   (criterio h) o menu promete "Acompanhamento físico-financeiro de obras em execução", mas a rota não entrega
--                nada próprio — cai em "Resultado por obra" (margem previsto × realizado).
--
-- A decisão HB0 (item 1) já era TIRAR "Acompanhamento" do menu e manter o redirect para favoritos antigos. A migration
-- 20261023160045 tentou isso com array_remove(surface_in_groups,'hub'), mas NÃO surtiu efeito: este módulo tem
-- grupo = 'hub', e fn_modulos_sidebar_por_area surfa pelo PRIMEIRO ramo (WHERE mc.grupo = p_area_id), independente de
-- surface_in_groups. Por isso o item continuou aparecendo (ordem 131) e o auditor o reencontrou.
--
-- A remoção que o primeiro ramo respeita é ativo = false (WHERE mc.ativo = true). ADITIVA e idempotente: só desliga o
-- item de menu duplicado; nenhuma tabela, função, RLS ou dado de cliente é tocado. A rota segue viva (o page.tsx
-- continua redirecionando para /obras/resultado), então favoritos/links antigos não quebram.
--
-- Prova (RD-38), em produção, BEGIN…ROLLBACK:
--   ANTES : fn_modulos_sidebar_por_area('hub',NULL,NULL) → projetos_acompanhamento = 1, projetos_resultado_obra = 1
--   DEPOIS: fn_modulos_sidebar_por_area('hub',NULL,NULL) → projetos_acompanhamento = 0, projetos_resultado_obra = 1

UPDATE public.module_catalog
   SET ativo = false
 WHERE id = 'projetos_acompanhamento'
   AND ativo = true;
