-- ═══════════════════════════════════════════════════════════════
-- FONTE: custo de folha por setor + turnover (Industrial B2 · BI de Gente)
-- ═══════════════════════════════════════════════════════════════
-- Cards de "Custo de folha por setor" e "Turnover" estavam vazios porque NÃO existia
-- fonte (nenhuma view/RPC). Esta migração cria a fonte cruzando folha × dimensão setor.
--
-- security_invoker = on OBRIGATÓRIO: view financeira multi-tenant. Sem isso roda como
-- owner e vaza entre empresas (Pilar 2/LGPD). folha_competencia e ind_pessoa têm RLS.
-- RD-45: join escopado por company_id. RD-51: pró-labore e SEM SETOR isolados, nunca
-- diluídos. RD-53: junho SUM(custo_total) = 800.795,47 (provado antes do merge).
-- RD-44/RD-38: pró-labore é identificado por DADO — ind_pessoa.vinculo='prolabore'
-- (atributo de pessoa, genérico p/ qualquer empresa), NÃO por range de matrícula.
-- Prova (Frioeste): vinculo='prolabore' = {965,967,968,969,970,971}; o range 965–971
-- incluía 966, que NÃO é pró-labore — o hardcode era mais frágil que o sinal real.
-- RD-52: NÃO unificar EXPEDIÇÃO/EXPEDIÇÃO/ENTREGAS aqui — é higiene na dimensão (ind_pessoa),
-- decisão do Jian, arquivo separado.

CREATE OR REPLACE VIEW public.v_custo_folha_setor
WITH (security_invoker = on) AS
SELECT
  f.company_id,
  f.competencia,
  CASE
    WHEN lower(COALESCE(p.vinculo,'')) = 'prolabore' THEN 'PRÓ-LABORE (sócios)'
    ELSE COALESCE(NULLIF(TRIM(p.setor), ''), '⚠️ SEM SETOR')
  END                                    AS setor,
  count(DISTINCT f.matricula)            AS colaboradores,
  sum(f.total_geral)                     AS custo_total,      -- CUSTO (régua)
  sum(f.remuneracao)                     AS remuneracao_base  -- base (coluna 2)
FROM public.folha_competencia f
LEFT JOIN public.ind_pessoa p
  ON p.matricula = f.matricula
 AND p.company_id = f.company_id          -- RD-45: escopo por empresa
GROUP BY f.company_id, f.competencia, 3;

-- RPC: custo por setor de uma competência (+ % do total) — alimenta o card
CREATE OR REPLACE FUNCTION public.fn_custo_folha_setor(
  p_company_id uuid,
  p_competencia date
)
RETURNS TABLE(
  setor text, colaboradores bigint,
  custo_total numeric, remuneracao_base numeric, pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH base AS (
    SELECT setor, colaboradores, custo_total, remuneracao_base
    FROM public.v_custo_folha_setor
    WHERE company_id = p_company_id AND competencia = p_competencia
  ), tot AS (SELECT COALESCE(sum(custo_total),0) t FROM base)
  SELECT b.setor, b.colaboradores, b.custo_total, b.remuneracao_base,
         round(100 * b.custo_total / NULLIF((SELECT t FROM tot),0), 1)
  FROM base b
  ORDER BY b.custo_total DESC;
$$;

-- RPC: turnover por competência — BASE = DESLIGAMENTO (não entrada). Exclui pró-labore (vinculo).
-- Mesma lógica da auditoria (RD-26/RD-52): headcount = ativos na competência; desligamentos =
-- demissão dentro da competência; março marcado como artefato (admissão = rebuild da base).
CREATE OR REPLACE FUNCTION public.fn_turnover_periodo(
  p_company_id uuid,
  p_competencia date
)
RETURNS TABLE(
  competencia date, desligamentos int, headcount int,
  turnover_pct numeric, artefato_rebuild boolean
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH mes AS (SELECT date_trunc('month', p_competencia)::date AS ini,
                      (date_trunc('month', p_competencia) + interval '1 month')::date - 1 AS fim),
  hc AS (
    SELECT count(*)::int n FROM public.ind_pessoa p, mes
    WHERE p.company_id = p_company_id
      AND lower(COALESCE(p.vinculo,'')) <> 'prolabore'
      AND p.admissao <= mes.fim
      AND (p.demissao IS NULL OR p.demissao >= mes.ini)
  ),
  dl AS (
    SELECT count(*)::int n FROM public.ind_pessoa p, mes
    WHERE p.company_id = p_company_id
      AND lower(COALESCE(p.vinculo,'')) <> 'prolabore'
      AND p.demissao BETWEEN mes.ini AND mes.fim
  )
  SELECT (SELECT ini FROM mes), (SELECT n FROM dl), (SELECT n FROM hc),
         round(100.0 * (SELECT n FROM dl) / NULLIF((SELECT n FROM hc), 0), 1),
         (date_trunc('month', p_competencia) = '2026-03-01'::date);
$$;
