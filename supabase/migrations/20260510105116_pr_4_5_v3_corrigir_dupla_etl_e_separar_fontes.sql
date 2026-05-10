-- PR 4.5 v3: corrigir contaminacao receita/despesa
-- Bug conceitual descoberto: ON CONFLICT DO UPDATE + colisao codigo (99.99)
-- somou despesa ao valor de receita, inflando receita.
--
-- Solucao: usar source diferenciado na chave + DELETE+INSERT puro sem ON CONFLICT

-- ETAPA 1: Apagar TUDO de receita e despesa (legacy + novos)
DELETE FROM public.psgc_dre
WHERE source IN ('pr_4_4_re_etl_receita', 'pr_4_5_re_etl_despesa', 'etl_pagar_omie', 'etl_receber', 'etl');

-- ETAPA 2: Adicionar 'source' a chave UNIQUE (assim receita e despesa podem coexistir)
ALTER TABLE public.psgc_dre DROP CONSTRAINT IF EXISTS idx_dre_unique_v2;

ALTER TABLE public.psgc_dre
  ADD CONSTRAINT idx_dre_unique_v3
  UNIQUE NULLS NOT DISTINCT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source);

COMMENT ON CONSTRAINT idx_dre_unique_v3 ON public.psgc_dre IS
'Unique key V3 incluindo source (receita vs despesa nao colidem). PR 4.5 - 10/05/2026.';

-- ETAPA 3: Re-INSERT receita competencia (limpo)
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  r.company_id,
  EXTRACT(YEAR FROM r.data_emissao)::int,
  EXTRACT(MONTH FROM r.data_emissao)::int,
  NULL::uuid, NULL::text,
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND dp.origem_codigo = r.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND LOWER(dp.origem_descricao) = LOWER(r.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  SUM(r.valor)::numeric,
  COUNT(*)::int,
  'pr_4_4_re_etl_receita',
  'competencia',
  DATE_TRUNC('month', r.data_emissao)::date,
  COALESCE(r.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_receber r
WHERE r.valor > 0 AND r.data_emissao IS NOT NULL
GROUP BY
  r.company_id, EXTRACT(YEAR FROM r.data_emissao), EXTRACT(MONTH FROM r.data_emissao),
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND dp.origem_codigo = r.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND LOWER(dp.origem_descricao) = LOWER(r.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  DATE_TRUNC('month', r.data_emissao),
  COALESCE(r.ref_externa_sistema, 'manual');

-- ETAPA 4: Re-INSERT receita caixa (limpo)
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  r.company_id,
  EXTRACT(YEAR FROM r.data_pagamento)::int,
  EXTRACT(MONTH FROM r.data_pagamento)::int,
  NULL::uuid, NULL::text,
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND dp.origem_codigo = r.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND LOWER(dp.origem_descricao) = LOWER(r.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  SUM(r.valor)::numeric,
  COUNT(*)::int,
  'pr_4_4_re_etl_receita',
  'caixa',
  DATE_TRUNC('month', r.data_pagamento)::date,
  COALESCE(r.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_receber r
WHERE r.valor > 0 AND r.data_pagamento IS NOT NULL
GROUP BY
  r.company_id, EXTRACT(YEAR FROM r.data_pagamento), EXTRACT(MONTH FROM r.data_pagamento),
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND dp.origem_codigo = r.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = r.company_id
       AND LOWER(dp.origem_descricao) = LOWER(r.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  DATE_TRUNC('month', r.data_pagamento),
  COALESCE(r.ref_externa_sistema, 'manual');

-- ETAPA 5: INSERT despesa competencia (limpo, sem ON CONFLICT pq source diferente)
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  p.company_id,
  EXTRACT(YEAR FROM p.data_emissao)::int,
  EXTRACT(MONTH FROM p.data_emissao)::int,
  NULL::uuid, NULL::text,
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  SUM(p.valor)::numeric,
  COUNT(*)::int,
  'pr_4_5_re_etl_despesa',
  'competencia',
  DATE_TRUNC('month', p.data_emissao)::date,
  COALESCE(p.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_pagar p
WHERE p.valor > 0 AND p.data_emissao IS NOT NULL
GROUP BY
  p.company_id, EXTRACT(YEAR FROM p.data_emissao), EXTRACT(MONTH FROM p.data_emissao),
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  DATE_TRUNC('month', p.data_emissao),
  COALESCE(p.ref_externa_sistema, 'manual');

-- ETAPA 6: INSERT despesa caixa
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  p.company_id,
  EXTRACT(YEAR FROM p.data_pagamento)::int,
  EXTRACT(MONTH FROM p.data_pagamento)::int,
  NULL::uuid, NULL::text,
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  SUM(p.valor)::numeric,
  COUNT(*)::int,
  'pr_4_5_re_etl_despesa',
  'caixa',
  DATE_TRUNC('month', p.data_pagamento)::date,
  COALESCE(p.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_pagar p
WHERE p.valor > 0 AND p.data_pagamento IS NOT NULL
GROUP BY
  p.company_id, EXTRACT(YEAR FROM p.data_pagamento), EXTRACT(MONTH FROM p.data_pagamento),
  COALESCE(
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
    (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
       AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
    '99.99'
  ),
  DATE_TRUNC('month', p.data_pagamento),
  COALESCE(p.ref_externa_sistema, 'manual');
