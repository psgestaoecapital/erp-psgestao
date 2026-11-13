-- DEMO 005 (Indústria) · ramo industrial para o menu de Produtividade aparecer
-- ============================================================================
-- GAP (auditor_pdca / aud8): as telas de Produtividade (produtos, custos-posto,
-- apontamento, tarefas, mapa) têm module_catalog.ramos_aplicaveis = ['bovinos'].
-- A DEMO 005 ("Indústria (SST) - DEMO", b0700000-0000-4000-a000-000000000005) é um
-- abatedouro bovino (setores Abate/Desossa, 13 produtos BOV-* ativos), MAS a empresa
-- estava sem ramo (industria_subtipo NULL e planta DEMO-SST com especies vazio) ->
-- ramos_da_empresa() = {} -> o filtro de menu fn_modulos_sidebar_por_area esconde as
-- telas ("Sem plano ativo nesta área") e o selo das telas fica bloqueado por MENU.
--
-- RD-102 (nada hardcoded em ramo no CÓDIGO): isto NÃO hardcoda ramo em feature nenhuma;
-- apenas CLASSIFICA a empresa DEMO conforme o que ela de fato é (bovina). O produto segue
-- genérico (kg, bovinos/suínos/aves/serraria); quem decide a visibilidade é o ramo da
-- empresa cruzado com ramos_aplicaveis do catálogo.
--
-- ADITIVO (RD-55) e idempotente: só UPDATE de DADO de empresa DEMO (não é cliente real),
-- guardado ao id fixo da DEMO 005, e só quando o campo está vazio (nunca sobrescreve valor).
-- Sem DDL, sem RLS, sem função. Preserva contagem de linhas.
--
-- RD-38 (prova no dado, antes/depois):
--   ANTES : ramos_da_empresa(005) = {}            -> ['bovinos'] && {} = false (tela escondida)
--   DEPOIS: ramos_da_empresa(005) contém 'bovinos'-> ['bovinos'] && {...} = true (tela visível)
-- ============================================================================

-- 1) ramo da empresa pela via companies.industria_subtipo
UPDATE public.companies
SET industria_subtipo = 'bovinos'
WHERE id = 'b0700000-0000-4000-a000-000000000005'
  AND (industria_subtipo IS NULL OR btrim(industria_subtipo) = '');

-- 2) ramo também pela via da planta (especies), para robustez do ramos_da_empresa()
UPDATE public.industrial_plants
SET especies = ARRAY['bovinos']::text[]
WHERE company_id = 'b0700000-0000-4000-a000-000000000005'
  AND codigo_planta = 'DEMO-SST'
  AND (especies IS NULL OR cardinality(especies) = 0);
