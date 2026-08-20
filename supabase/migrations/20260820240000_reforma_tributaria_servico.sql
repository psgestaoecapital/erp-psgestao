-- Reforma Tributária no serviço · estrutura (regime + correlação + parâmetro por ano). Fronteira GE (fiscal).
--
-- Premissas auditadas (premissa-primeiro, RD-38):
--  • companies.regime_tributario está bagunçado: 'simples'(3), 'presumido'(1), 'real'(2) além dos
--    canônicos. Normaliza pros valores canônicos (mantém null e 'pessoa_fisica' como estão).
--  • A aba RT do ServicoForm passa a ler companies.regime_tributario (fonte única, RD-52) — antes lia
--    erp_fiscal_provider_config que só tinha 'simples_nacional'.
--  • Não existe tabela de reforma/IBS/CBS/correlação — greenfield.
--  • correlacao_fiscal_lc116_nbs.json: 896 linhas (lc116, nbs, cindop, cclasstrib, cclasstrib_nome).
--    NÃO traz CST → rt_cst não é auto-preenchível pela correlação (fica manual). 60 NBS mapeiam
--    >1 cclasstrib conforme o LC116, então o lookup casa por (lc116, nbs); por NBS só quando único.

-- 1) Normaliza o regime tributário (idempotente).
UPDATE public.companies SET regime_tributario = CASE lower(btrim(regime_tributario))
    WHEN 'simples'    THEN 'simples_nacional'
    WHEN 'presumido'  THEN 'lucro_presumido'
    WHEN 'real'       THEN 'lucro_real'
    ELSE regime_tributario END
  WHERE lower(btrim(COALESCE(regime_tributario,''))) IN ('simples','presumido','real');

-- 2) Correlação LC116×NBS → indicador de operação (indOpRT) + classificação tributária (cClassTrib).
CREATE TABLE IF NOT EXISTS public.fiscal_correlacao_servico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lc116           text NOT NULL,
  nbs             text NOT NULL,
  cindop          text,          -- indicador de operação (rt_indicador_operacao)
  cclasstrib      text,          -- classificação tributária (rt_classificacao_tributaria)
  cclasstrib_nome text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lc116, nbs)
);
CREATE INDEX IF NOT EXISTS idx_fcs_nbs   ON public.fiscal_correlacao_servico (nbs);
CREATE INDEX IF NOT EXISTS idx_fcs_lc116 ON public.fiscal_correlacao_servico (lc116);
ALTER TABLE public.fiscal_correlacao_servico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fcs_read ON public.fiscal_correlacao_servico;
CREATE POLICY fcs_read  ON public.fiscal_correlacao_servico FOR SELECT USING (true);
DROP POLICY IF EXISTS fcs_write ON public.fiscal_correlacao_servico;
CREATE POLICY fcs_write ON public.fiscal_correlacao_servico FOR ALL USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON public.fiscal_correlacao_servico FROM anon;

-- 3) Alíquotas IBS/CBS por ANO (parâmetro editável, não hardcoded).
CREATE TABLE IF NOT EXISTS public.fiscal_reforma_parametro (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ano         int NOT NULL UNIQUE,
  cbs_pct     numeric NOT NULL DEFAULT 0,
  ibs_uf_pct  numeric NOT NULL DEFAULT 0,
  ibs_mun_pct numeric NOT NULL DEFAULT 0,
  observacao  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fiscal_reforma_parametro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frp_read ON public.fiscal_reforma_parametro;
CREATE POLICY frp_read  ON public.fiscal_reforma_parametro FOR SELECT USING (true);
DROP POLICY IF EXISTS frp_write ON public.fiscal_reforma_parametro;
CREATE POLICY frp_write ON public.fiscal_reforma_parametro FOR ALL USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON public.fiscal_reforma_parametro FROM anon;

-- Valores de TESTE 2026 (fase de transição EC 132 / LC 214): CBS 0,9% + IBS 0,1%.
-- O split UF/Município do IBS de teste é editável aqui (colocado todo na UF por ora) — confirmar.
INSERT INTO public.fiscal_reforma_parametro (ano, cbs_pct, ibs_uf_pct, ibs_mun_pct, observacao)
VALUES (2026, 0.9, 0.1, 0.0, 'Teste 2026 (EC 132/LC 214): CBS 0,9% + IBS 0,1%. Split UF/Mun a confirmar.')
ON CONFLICT (ano) DO NOTHING;

-- 4) Lookup da correlação: casa por (lc116, nbs); por NBS só quando a classificação é única.
--    Devolve cclasstrib/cindop só quando NÃO ambíguo (senão deixa manual — não chuta imposto).
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
  WITH cand AS (
    SELECT c.cclasstrib, c.cclasstrib_nome, c.cindop
    FROM public.fiscal_correlacao_servico c
    WHERE c.nbs = btrim(p_nbs)
      AND (NULLIF(btrim(COALESCE(p_lc116,'')),'') IS NULL OR c.lc116 = btrim(p_lc116))
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
REVOKE ALL ON FUNCTION public.fn_reforma_correlacao_servico(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reforma_correlacao_servico(text, text) TO authenticated;

-- 5) Parâmetro IBS/CBS do ano (ou o último ano definido <= p_ano).
CREATE OR REPLACE FUNCTION public.fn_reforma_parametro_ano(p_ano int)
RETURNS TABLE(ano int, cbs_pct numeric, ibs_uf_pct numeric, ibs_mun_pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.ano, p.cbs_pct, p.ibs_uf_pct, p.ibs_mun_pct
  FROM public.fiscal_reforma_parametro p
  WHERE p.ano <= COALESCE(p_ano, p.ano)
  ORDER BY p.ano DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_reforma_parametro_ano(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reforma_parametro_ano(int) TO authenticated;
