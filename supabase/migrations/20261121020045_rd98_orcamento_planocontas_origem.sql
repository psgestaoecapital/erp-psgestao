-- RD-98 p3 (origem do dado) — registra a origem do dado (views/tabelas lidas) de 2
-- telas que estavam com views_consumidas vazio em system_screens, e classifica o
-- estado_real de /dashboard/dre-divisional/plano-contas quando ainda 'desconhecida'.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem o comportamento das telas. ADITIVA e IDEMPOTENTE: só
-- preenche quando ainda vazio e só classifica quando ainda 'desconhecida'.
--
-- Fontes PROVADAS no código (RD-38, supabase.from):
--   /dashboard/orcamento                     → users, companies, user_companies, omie_imports, orcamento
--   /dashboard/dre-divisional/plano-contas   → psgc_contas, psgc_contas_custom
-- Existência das tabelas conferida no banco (information_schema). Nenhuma RPC pg é
-- chamada por essas telas (rpcs_chamadas permanece vazio).
-- Code: desenvolvedor_4_g

-- /dashboard/orcamento — Orçamento (planejamento x realizado)
UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','omie_imports','orcamento']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/orcamento'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/dre-divisional/plano-contas — Plano de contas da DRE divisional
UPDATE public.system_screens
SET estado_real = 'pronto'
WHERE rota = '/dashboard/dre-divisional/plano-contas' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['psgc_contas','psgc_contas_custom']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/dre-divisional/plano-contas'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
