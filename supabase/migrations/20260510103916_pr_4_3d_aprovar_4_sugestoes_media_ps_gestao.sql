-- ═══════════════════════════════════════════════════════════════
-- PR 4.3d: Aprovacao manual das 4 sugestoes media confianca
-- ═══════════════════════════════════════════════════════════════
-- Objetivo: aprovar manualmente 4 sugestoes obvias (todas Ps Gestao):
-- 1. "7 - Impostos" Ps Gestao LTDA -> 3.4 (R$ 19.994)
-- 2. "7 - Impostos" GESTAO CAPITAL -> 3.4 (R$ 19.944)
-- 3. "Receita Recorrente" Ps Gestao LTDA -> 1.1 (R$ 11.500)
-- 4. "Outras Receitas Operacionais" Ps Gestao LTDA -> 1.1 (R$ 4.195)
--
-- Total adicional: R$ 55.633 cobertos
-- Idempotente: usa mesmo padrao UPSERT do 4.3c
-- ═══════════════════════════════════════════════════════════════

WITH aplicacao AS (
  INSERT INTO public.psgc_depara (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo, metodo, confianca, revisado, observacao, ativo, created_at, updated_at
  )
  SELECT
    s.company_id,
    COALESCE(s.origem_codigo, s.origem_descricao) AS origem_codigo,
    s.origem_descricao,
    s.origem_sistema,
    s.psgc_codigo_sugerido AS psgc_codigo,
    'manual'::text AS metodo,  -- aprovacao manual CEO
    s.confianca_calculada AS confianca,
    true AS revisado,  -- aprovado manualmente
    CONCAT(
      'PR 4.3d - aprovacao manual CEO - ',
      'estrategia: ', s.estrategia, ' | conf: ', s.confianca_calculada,
      ' | sugestao foi cruzada com outras empresas PS Gestao'
    ) AS observacao,
    true AS ativo,
    NOW(),
    NOW()
  FROM public.psgc_depara_sugestoes s
  WHERE s.status = 'pendente'
    AND s.confianca_calculada BETWEEN 70 AND 84  -- as 4 media
  ON CONFLICT (company_id, origem_codigo, origem_sistema)
  DO UPDATE SET
    psgc_codigo = EXCLUDED.psgc_codigo,
    confianca = EXCLUDED.confianca,
    metodo = EXCLUDED.metodo,
    revisado = true,
    observacao = CONCAT(COALESCE(psgc_depara.observacao, ''), ' | aprov manual PR 4.3d'),
    updated_at = NOW(),
    ativo = true
  RETURNING id, company_id, origem_codigo, origem_sistema
)
UPDATE public.psgc_depara_sugestoes s
SET
  status = 'aplicada',
  psgc_codigo_aprovado = s.psgc_codigo_sugerido,
  aprovado_em = NOW(),
  observacao_revisao = 'Aprovacao manual CEO PR 4.3d - 10/05/2026'
FROM aplicacao a
WHERE s.company_id = a.company_id
  AND COALESCE(s.origem_codigo, s.origem_descricao) = a.origem_codigo
  AND s.origem_sistema = a.origem_sistema
  AND s.status = 'pendente';
