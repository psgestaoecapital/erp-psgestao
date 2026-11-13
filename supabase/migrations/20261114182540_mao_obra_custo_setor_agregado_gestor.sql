-- Mão de Obra (Indústria · RH): custo agregado por setor visível ao GESTOR/DIRETORIA
-- sem expor salário individual (LGPD).
--
-- PROBLEMA (aud8 70/95): /dashboard/industrial/mao-obra bloqueia a TELA INTEIRA
-- em fn__pode_ver_folha (RH-only). Um gestor de produção/diretoria sem papel RH
-- não enxerga nem o custo AGREGADO de mão de obra (número gerencial, não-sensível).
-- O painel agregado (fn_custo_folha_setor / v_custo_folha_setor) é security_invoker,
-- e a folha tem RLS RH-only (HOTFIX 4) → para o gestor não-RH volta vazio.
--
-- SOLUÇÃO: RPC SECURITY DEFINER que devolve SOMENTE o agregado por setor
-- (setor, nº de colaboradores, custo total, % ), NUNCA nome nem salário individual.
-- Guarda = empresa + gestor/diretoria (fn__mao_obra_pode_ver_individual: owner,
-- sócio, diretor, gerente, financeiro, admin). O salário INDIVIDUAL segue RH-only
-- na tela (fn__pode_ver_folha), inalterado.
--
-- Aditivo (função NOVA), sem tocar RLS/dado de cliente. REVOKE anon.
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_custo_folha_setor_agregado(p_company_id uuid)
RETURNS TABLE(
  competencia      date,
  setor            text,
  colaboradores    bigint,
  custo_total      numeric,
  remuneracao_base numeric,
  pct              numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  -- Agregado é gerencial: liberado a gestor/diretoria/financeiro (não exige RH).
  -- Não devolve nada individual, então não há vazamento de salário por pessoa.
  IF NOT public.fn__mao_obra_pode_ver_individual(p_company_id) THEN
    RAISE EXCEPTION 'Sem acesso ao custo de mão de obra desta empresa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT v.competencia, v.setor, v.colaboradores, v.custo_total, v.remuneracao_base
    FROM public.v_custo_folha_setor v
    WHERE v.company_id = p_company_id
  ), tot AS (
    SELECT b.competencia AS c, SUM(b.custo_total) AS t
    FROM base b GROUP BY b.competencia
  )
  SELECT b.competencia, b.setor, b.colaboradores, b.custo_total, b.remuneracao_base,
         round(100 * b.custo_total / NULLIF((SELECT t FROM tot WHERE tot.c = b.competencia), 0), 1)
  FROM base b
  ORDER BY b.competencia DESC, b.custo_total DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_custo_folha_setor_agregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_custo_folha_setor_agregado(uuid) TO authenticated, service_role;
