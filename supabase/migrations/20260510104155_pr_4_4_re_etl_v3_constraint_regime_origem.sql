-- PR 4.4 v3: Refactor UNIQUE constraint + Re-ETL completo
--
-- DECISAO ARQUITETURAL (Regra #36 Hierarquia da Verdade):
-- UNIQUE atual: (company_id, ano, mes, ln_id, psgc_codigo)
-- ERRADO: nao permite regime competencia + caixa coexistirem
--
-- UNIQUE novo: (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento)
-- CORRETO: cada regime + origem fica em row separado
--
-- IMPACTO: psgc_dre suporta multiplos regimes simultaneamente

-- ETAPA 1: Drop UNIQUE antigo
ALTER TABLE public.psgc_dre DROP CONSTRAINT IF EXISTS idx_dre_unique;

-- ETAPA 2: Drop o INDEX que pode ter sido criado separadamente
DROP INDEX IF EXISTS public.idx_dre_unique;

-- ETAPA 3: DELETE legacy_v0
DELETE FROM public.psgc_dre WHERE regime = 'legacy_v0';

-- ETAPA 4: Re-INSERT competencia
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome,
  psgc_codigo, valor, qtd_lancamentos,
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

-- ETAPA 5: Re-INSERT caixa
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome,
  psgc_codigo, valor, qtd_lancamentos,
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

-- ETAPA 6: Recriar UNIQUE com regime + origem
ALTER TABLE public.psgc_dre
  ADD CONSTRAINT idx_dre_unique_v2
  UNIQUE NULLS NOT DISTINCT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento);

COMMENT ON CONSTRAINT idx_dre_unique_v2 ON public.psgc_dre IS
'Unique key V2 incluindo regime + origem_sistema (Regra #36 Hierarquia da Verdade). PR 4.4 - 10/05/2026.';
