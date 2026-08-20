-- RT · corrige 2 achados da validação do #1079 no serviço "Mão de Obra de Gessos". Fronteira GE (fiscal).
--
-- Achado 1 (LC116): a migration anterior normalizou o CATÁLOGO ("7.02"→"07.02") mas NÃO os
--   erp_servicos.codigo_lc116 já gravados — o serviço seguia com "070202" (6 díg.). Normaliza os
--   valores 6-dígitos pro subitem oficial GG.SS (070202→07.02, 170101→17.01), só onde o resultado
--   existe no catálogo padded. Preserva a intenção (não troca o código, só o formato).
--
-- Correção de premissa (RD-51): o auto-RT NÃO depende do LC116 pra este NBS. A correlação de
--   nbs '1.0107.20.00' tem UMA linha só (lc116 07.06 → cClassTrib 200046) → o lookup por NBS já
--   resolve sozinho. O problema é que, passando um LC116 que NÃO casa o par (ex.: 07.02), o lookup
--   ficava vazio (encontrou=false) e QUEBRAVA o auto-preenchimento que funcionaria por NBS.
--   Fix: o lookup usa o par (nbs,lc116) quando ele existe; senão cai pro NBS-só (fallback).

-- 1) Lookup com fallback: par (nbs,lc116) → senão NBS-só. Desambigua sem quebrar o caso não-ambíguo.
CREATE OR REPLACE FUNCTION public.fn_reforma_correlacao_servico(
  p_nbs text,
  p_lc116 text DEFAULT NULL
)
RETURNS TABLE(cclasstrib text, cclasstrib_nome text, cindop text, ambiguo boolean, encontrou boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT c.cclasstrib, c.cclasstrib_nome, c.cindop, c.lc116
    FROM public.fiscal_correlacao_servico c
    WHERE c.nbs = btrim(p_nbs)
  ),
  par AS (
    SELECT b.cclasstrib, b.cclasstrib_nome, b.cindop FROM base b
    WHERE NULLIF(btrim(COALESCE(p_lc116, '')), '') IS NOT NULL AND b.lc116 = btrim(p_lc116)
  ),
  cand AS (
    SELECT cclasstrib, cclasstrib_nome, cindop FROM par
    UNION ALL
    SELECT cclasstrib, cclasstrib_nome, cindop FROM base WHERE NOT EXISTS (SELECT 1 FROM par)
  ),
  agg AS (
    SELECT count(DISTINCT cclasstrib) FILTER (WHERE cclasstrib IS NOT NULL) AS n_class,
           count(DISTINCT cindop)     FILTER (WHERE cindop IS NOT NULL) AS n_indop,
           count(*) AS n
    FROM cand
  )
  SELECT
    CASE WHEN a.n_class = 1 THEN (SELECT DISTINCT c.cclasstrib FROM cand c WHERE c.cclasstrib IS NOT NULL) END,
    CASE WHEN a.n_class = 1 THEN (SELECT c.cclasstrib_nome FROM cand c WHERE c.cclasstrib IS NOT NULL LIMIT 1) END,
    CASE WHEN a.n_indop = 1 THEN (SELECT DISTINCT c.cindop FROM cand c WHERE c.cindop IS NOT NULL) END,
    (a.n_class > 1 OR a.n_indop > 1),
    (a.n > 0)
  FROM agg a;
$function$;

-- 2) Normaliza os codigo_lc116 6-dígitos gravados pro subitem GG.SS (só onde existe no catálogo).
UPDATE public.erp_servicos s
SET codigo_lc116 = left(regexp_replace(s.codigo_lc116, '\D', '', 'g'), 2) || '.' ||
                   substr(regexp_replace(s.codigo_lc116, '\D', '', 'g'), 3, 2)
WHERE s.codigo_lc116 ~ '^[0-9]{6}$'
  AND EXISTS (
    SELECT 1 FROM public.fiscal_codigo_catalogo c
    WHERE c.tipo = 'lc116'
      AND c.codigo = left(regexp_replace(s.codigo_lc116, '\D', '', 'g'), 2) || '.' ||
                     substr(regexp_replace(s.codigo_lc116, '\D', '', 'g'), 3, 2)
  );
