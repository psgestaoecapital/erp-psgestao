-- PR 4.3c v3: dedup via DISTINCT ON antes do UPSERT
-- Fix: 1 sugestao duplicada (PDOIS Foto/Filmagem) precisa ser deduplicada

WITH sugestoes_dedup AS (
  -- Pega a sugestao com MAIOR valor para cada combinacao unica
  SELECT DISTINCT ON (company_id, COALESCE(origem_codigo, origem_descricao), origem_sistema)
    id,
    company_id,
    origem_codigo,
    origem_descricao,
    origem_sistema,
    psgc_codigo_sugerido,
    confianca_calculada,
    estrategia,
    evidencia,
    valor_total_afetado
  FROM psgc_depara_sugestoes
  WHERE status = 'pendente' AND confianca_calculada >= 85
  ORDER BY
    company_id,
    COALESCE(origem_codigo, origem_descricao),
    origem_sistema,
    valor_total_afetado DESC NULLS LAST  -- Prioriza maior valor
),
aplicacao AS (
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
    'auto_keyword'::text AS metodo,
    s.confianca_calculada AS confianca,
    false AS revisado,
    CONCAT(
      'PR 4.3c - estrategia: ', s.estrategia,
      ' | confianca: ', s.confianca_calculada,
      CASE
        WHEN s.evidencia->>'metodo' = 'override_financiamento_subarea'
          THEN ' | fix Pronamp (subarea -> 8.2)'
        WHEN s.evidencia->>'sugestao_outra_empresa' IS NOT NULL
          THEN ' | match outra empresa'
        WHEN s.evidencia->>'empresas_que_confirmam' IS NOT NULL
          THEN ' | confirmado por ' || (s.evidencia->>'empresas_que_confirmam') || ' empresas Omie'
        ELSE ''
      END
    ) AS observacao,
    true AS ativo,
    NOW(),
    NOW()
  FROM sugestoes_dedup s
  ON CONFLICT (company_id, origem_codigo, origem_sistema)
  DO UPDATE SET
    psgc_codigo = EXCLUDED.psgc_codigo,
    confianca = EXCLUDED.confianca,
    metodo = EXCLUDED.metodo,
    observacao = CONCAT(COALESCE(psgc_depara.observacao, ''), ' | re-mapeado PR 4.3c'),
    updated_at = NOW(),
    ativo = true
  RETURNING id, company_id, origem_codigo, origem_sistema
)
-- Marcar TODAS as sugestoes alta como aplicada (incluindo a duplicata)
UPDATE public.psgc_depara_sugestoes s
SET
  status = 'aplicada',
  psgc_codigo_aprovado = s.psgc_codigo_sugerido,
  aprovado_em = NOW(),
  observacao_revisao = 'Aplicacao automatica PR 4.3c - alta confianca >=85'
FROM aplicacao a
WHERE s.company_id = a.company_id
  AND COALESCE(s.origem_codigo, s.origem_descricao) = a.origem_codigo
  AND s.origem_sistema = a.origem_sistema
  AND s.status = 'pendente'
  AND s.confianca_calculada >= 85;
