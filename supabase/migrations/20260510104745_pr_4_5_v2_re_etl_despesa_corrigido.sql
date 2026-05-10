-- PR 4.5 v2: Re-ETL despesa com filtro anti-conflito + RPC Truth Auditor

-- ETAPA 1: DELETE registros de despesa anteriores (mais abrangente)
DELETE FROM public.psgc_dre
WHERE source IN ('etl', 'pr_4_5_re_etl_despesa');

-- ETAPA 2: INSERT despesa competencia
-- Detalhe: se categoria mapear para 1.x/3.x (que ja sao receita do PR 4.4),
-- usa 99.99 para nao gerar conflito UNIQUE (sao gastos mal mapeados)
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome,
  psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  p.company_id,
  EXTRACT(YEAR FROM p.data_emissao)::int,
  EXTRACT(MONTH FROM p.data_emissao)::int,
  NULL::uuid, NULL::text,
  CASE
    -- Se mapeamento aponta para grupo de RECEITA (1.x, 3.x), classificar como orfao
    WHEN COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1)
    ) ~ '^(1\.|3\.)'
      THEN '99.99'
    ELSE COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
      '99.99'
    )
  END AS psgc_codigo,
  SUM(p.valor)::numeric,
  COUNT(*)::int,
  'pr_4_5_re_etl_despesa'::text,
  'competencia'::text,
  DATE_TRUNC('month', p.data_emissao)::date,
  COALESCE(p.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_pagar p
WHERE p.valor > 0 AND p.data_emissao IS NOT NULL
GROUP BY
  p.company_id, EXTRACT(YEAR FROM p.data_emissao), EXTRACT(MONTH FROM p.data_emissao),
  CASE
    WHEN COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1)
    ) ~ '^(1\.|3\.)'
      THEN '99.99'
    ELSE COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
      '99.99'
    )
  END,
  DATE_TRUNC('month', p.data_emissao),
  COALESCE(p.ref_externa_sistema, 'manual')
ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento)
DO UPDATE SET
  valor = psgc_dre.valor + EXCLUDED.valor,
  qtd_lancamentos = psgc_dre.qtd_lancamentos + EXCLUDED.qtd_lancamentos,
  calculated_at = NOW();

-- ETAPA 3: INSERT despesa caixa
INSERT INTO public.psgc_dre (
  company_id, ano, mes, ln_id, ln_nome,
  psgc_codigo, valor, qtd_lancamentos,
  source, regime, data_referencia, origem_sistema_lancamento, calculated_at
)
SELECT
  p.company_id,
  EXTRACT(YEAR FROM p.data_pagamento)::int,
  EXTRACT(MONTH FROM p.data_pagamento)::int,
  NULL::uuid, NULL::text,
  CASE
    WHEN COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1)
    ) ~ '^(1\.|3\.)'
      THEN '99.99'
    ELSE COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
      '99.99'
    )
  END,
  SUM(p.valor)::numeric,
  COUNT(*)::int,
  'pr_4_5_re_etl_despesa'::text,
  'caixa'::text,
  DATE_TRUNC('month', p.data_pagamento)::date,
  COALESCE(p.ref_externa_sistema, 'manual')::text,
  NOW()
FROM erp_pagar p
WHERE p.valor > 0 AND p.data_pagamento IS NOT NULL
GROUP BY
  p.company_id, EXTRACT(YEAR FROM p.data_pagamento), EXTRACT(MONTH FROM p.data_pagamento),
  CASE
    WHEN COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1)
    ) ~ '^(1\.|3\.)'
      THEN '99.99'
    ELSE COALESCE(
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND dp.origem_codigo = p.categoria AND dp.ativo = true LIMIT 1),
      (SELECT psgc_codigo FROM psgc_depara dp WHERE dp.company_id = p.company_id
         AND LOWER(dp.origem_descricao) = LOWER(p.categoria) AND dp.ativo = true LIMIT 1),
      '99.99'
    )
  END,
  DATE_TRUNC('month', p.data_pagamento),
  COALESCE(p.ref_externa_sistema, 'manual')
ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento)
DO UPDATE SET
  valor = psgc_dre.valor + EXCLUDED.valor,
  qtd_lancamentos = psgc_dre.qtd_lancamentos + EXCLUDED.qtd_lancamentos,
  calculated_at = NOW();
