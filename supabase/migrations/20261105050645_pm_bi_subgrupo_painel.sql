-- P&M · nova aba "Inteligência BI" no menu (CEO 04/11) — cria o subgrupo pm_bi e move o
-- "Painel da agência" (pm_painel_agencia) para ele, separando-o do Comercial e do Financeiro.
--
-- Como o menu do P&M funciona (auditado no código vivo):
--   · fn_modulos_sidebar_por_area deriva a SEÇÃO do menu de UPPER(mc.subgrupo); logo, subgrupo
--     'pm_bi' vira a seção PM_BI. O rótulo visível do P&M mora no frontend (src/lib/menu/
--     useSidebarModulos.ts · SECAO_LABEL_OVERRIDE, 'PM_BI' → "Inteligência BI", alterado nesta PR).
--   · module_catalog.subgrupo tem FK para module_subgrupos(id); por isso o subgrupo precisa existir
--     lá ANTES do UPDATE (como os irmãos pm_comercial/pm_financeiro/…; label ali é só fallback).
--   · A ORDEM das seções do P&M é dada pela MENOR 'ordem' dos itens de cada subgrupo (não há linha
--     em area_secao_ordem para 'pm'; as seções empatam em secao_ordem e o front preserva a 1ª
--     aparição). Comercial ocupa 1..30 e Produção começa em 40; pondo o painel em ordem=35 a seção
--     "Inteligência BI" aparece LOGO APÓS o Comercial e ANTES de Produção/Financeiro.
--
-- ADITIVA: cria o subgrupo (linha nova) e só reposiciona um item de menu já existente; não cria tela
-- (a rota /dashboard/pm já existe) nem toca função/view/policy/RBAC (visibilidade é por modulo_id, não
-- por subgrupo). IDEMPOTENTE. RD-100: 'pm_bi' e "Inteligência BI" são marca própria, sem nome de terceiro.

INSERT INTO public.module_subgrupos (id, label, grupo, ordem, ativo)
VALUES ('pm_bi', 'Inteligência BI', 'pm', 35, true)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, grupo = EXCLUDED.grupo, ativo = true;

UPDATE public.module_catalog
   SET subgrupo = 'pm_bi',
       ordem    = 35
 WHERE id = 'pm_painel_agencia'
   AND grupo = 'pm';
