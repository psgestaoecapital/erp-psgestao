-- GAP2 do apontamento (decisão Eng. Chefe 12/11): a DEMO 005 é a demo de abatedouro BOVINO, mas estava sem ramo
-- (companies.industria_subtipo nulo, plantas sem especies) → ramos_da_empresa() = [] e o menu industrial, gated por
-- module_catalog.ramos_aplicaveis = ['bovinos'] (&& ramos_da_empresa), ESCONDIA as telas (apontamento, mapa etc.) —
-- a tela não era alcançável pelo menu, travando o selo (RD-98). A correção é no RAMO DA EMPRESA DEMO (dado da demo),
-- NÃO no module_catalog.
--
-- ADITIVO e idempotente: só marca o ramo da EMPRESA DEMO (fixo b0700000-…-005) como bovinos, nas duas fontes que
-- ramos_da_empresa() lê (companies.industria_subtipo + industrial_plants.especies), e só quando está vazio. Não toca
-- module_catalog, nem RLS/função/view, nem dado de cliente real. RD-69: a DEMO é fictícia.
-- Prova (produção, BEGIN/ROLLBACK): depois disto ramos_da_empresa(005) = ['bovinos'], o menu do apontamento aparece
-- e 5 telas industriais (gated por bovinos) ficam alcançáveis.

UPDATE public.companies
   SET industria_subtipo = 'bovinos'
 WHERE id = 'b0700000-0000-4000-a000-000000000005'
   AND (industria_subtipo IS NULL OR btrim(industria_subtipo) = '');

UPDATE public.industrial_plants
   SET especies = ARRAY['bovinos']
 WHERE company_id = 'b0700000-0000-4000-a000-000000000005'
   AND coalesce(is_active, true) = true
   AND (especies IS NULL OR cardinality(especies) = 0);
