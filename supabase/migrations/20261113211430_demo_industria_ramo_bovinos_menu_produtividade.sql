-- GAP do auditor (PDCA) — /dashboard/produtividade/mapa (MENU/RD-98)
-- Tela: a Indústria (SST) DEMO (…0005) é um ABATEDOURO de bovinos (setores Abate /
-- Desossa, 11 postos, fluxos "Linha de Abate" / "Linha de Desossa e Embalagem" já
-- semeados em prod_fluxo). Porém a planta DEMO está SEM ramo classificado
-- (industrial_plants.especies = {}), então ramos_da_empresa(…0005) = {} e todo o
-- subgrupo "Produtividade" do menu — que é ESPECÍFICO do ramo 'bovinos'
-- (module_catalog.ramos_aplicaveis = {bovinos}) — fica oculto: o menu lateral mostra
-- "Sem plano ativo nesta área" e a tela não é alcançável pelo menu nesse ramo
-- (bloqueia o selo RD-98). O 'bovinos' é, aliás, o caso canônico de NR-36/SST
-- (frigorífico), coerente com esta DEMO.
--
-- CORREÇÃO (provisionamento de DEMO): classifica a planta da DEMO como 'bovinos'.
-- Com isso ramos_da_empresa(…0005) passa a {bovinos} e as 4 telas de Produtividade
-- (Mapa do fluxo, Produtos, Tarefas e vídeos, Apontamento) passam a aparecer no menu.
--
-- SEGURANÇA / COMPATIBILIDADE:
-- - ADITIVA e IDEMPOTENTE (só acrescenta 'bovinos'; NOT EXISTS evita re-escrita).
-- - Guarda DUPLA: só a empresa DEMO de auditoria (id fixo da DEMO …0005
--   E companies.ambiente_tenant = 'auditoria'); NUNCA toca dado de cliente real.
-- - Puramente ADITIVA no menu: dar um ramo a uma empresa que estava sem ramo só
--   PASSA A INCLUIR módulos específicos desse ramo; nenhum módulo comum é perdido
--   (o filtro de ramo deixa passar módulo comum sempre).
-- - RD-38 (provado em BEGIN/ROLLBACK contra produção):
--     ramos_da_empresa(…0005): {} (antes) -> {bovinos} (depois)
--     produtividade_{mapa,produtos,tarefas,apontamento}: passa_filtro false -> true
--     re-rodar o UPDATE afeta 0 linhas (idempotente).

UPDATE public.industrial_plants p
   SET especies = coalesce(p.especies, ARRAY[]::text[]) || ARRAY['bovinos']::text[]
  FROM public.companies c
 WHERE p.company_id = c.id
   AND c.id = 'b0700000-0000-4000-a000-000000000005'
   AND c.ambiente_tenant = 'auditoria'
   AND coalesce(p.is_active, true) = true
   AND NOT ('bovinos' = ANY(coalesce(p.especies, ARRAY[]::text[])));
