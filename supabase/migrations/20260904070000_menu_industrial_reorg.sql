-- Menu da Indústria — 3 correções (pedido do CEO). Tudo em DADOS de catálogo; nenhuma rota muda.
--
-- Provado no dado (RD-38) antes de mexer:
--   • O sidebar é montado por fn_modulos_sidebar_por_area, que devolve MÓDULOS (module_catalog) e
--     ORDENA as seções por area_secao_ordem (com fallback hardcoded). Subgrupo sem módulo não gera
--     linha → JÁ não renderiza (a RPC devolveu 5 seções, todas com módulo). module_subgrupos NÃO é
--     lido por nenhuma função nem pelo front — é o REGISTRO dos ganchos de RBAC ("ficam vazios até o
--     módulo existir", migration 20260901140000). Então o lugar certo pra ordem do menu é area_secao_ordem.
--
-- 1) Módulos no subgrupo errado → move (module_catalog.subgrupo). A rota do módulo não muda.
UPDATE public.module_catalog SET subgrupo='rh_ponto'      WHERE id='industrial_ponto_eletronico';  -- Ponto: operacao → RH/Ponto
UPDATE public.module_catalog SET subgrupo='rh_ponto'      WHERE id='industrial_folha_pagamento';    -- Folha: abastecimento → RH/Ponto
UPDATE public.module_catalog SET subgrupo='inteligencia_bi' WHERE id='industrial_indicadores';      -- Plano de Indicadores: operacao → BI

-- 2) Seção vazia não renderiza: já garantido pela RPC (só devolve seção com módulo). Não desativamos
--    subgrupo nenhum — eles são os ganchos de permissão do RBAC. Só não aparecem enquanto vazios.

-- 3) Ordem determinística seguindo o fluxo da planta (area_secao_ordem é o que a RPC lê pra ordenar).
--    Sem isto, seções sem linha em area_secao_ordem caíam no fallback hardcoded (=6) e EMPATAVAM
--    (ex.: rh_ponto e produtividade), montando em ordem instável entre recargas.
INSERT INTO public.area_secao_ordem (area_slug, secao, ordem, ativo) VALUES
  ('industrial','INICIO',          5,  true),
  ('industrial','ABASTECIMENTO',   10, true),
  ('industrial','OPERACAO',        20, true),
  ('industrial','QUALIDADE_SIF',   30, true),
  ('industrial','EXPEDICAO',       40, true),
  ('industrial','MANUTENCAO',      50, true),
  ('industrial','ENGENHARIA',      60, true),
  ('industrial','PORTARIA',        70, true),
  ('industrial','RH_PONTO',        80, true),
  ('industrial','RV',              85, true),
  ('industrial','PRODUTIVIDADE',   90, true),
  ('industrial','INTELIGENCIA_BI', 95, true),
  ('industrial','AREA',            96, true),
  ('industrial','ADMINISTRACAO',   99, true)
ON CONFLICT (area_slug, secao) DO UPDATE SET ordem=EXCLUDED.ordem, ativo=true;

-- Mantém o REGISTRO (module_subgrupos) coerente com a ordem, para os subgrupos donos da Indústria.
-- (Ainda não é lido no render — quem ordena é area_secao_ordem; isto evita o registro "mentir" com 99.)
UPDATE public.module_subgrupos SET ordem = CASE id
  WHEN 'qualidade_sif' THEN 30 WHEN 'expedicao' THEN 40 WHEN 'manutencao' THEN 50
  WHEN 'engenharia' THEN 60 WHEN 'portaria' THEN 70 WHEN 'rh_ponto' THEN 80
  WHEN 'rv' THEN 85 WHEN 'produtividade' THEN 90 ELSE ordem END
WHERE grupo='industrial';
