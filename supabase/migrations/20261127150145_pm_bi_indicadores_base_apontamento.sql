-- P&M · tela 1 (BI da Agência) · go-live item 10 (CEO 25/11)
-- Problema provado no dado (RD-38): indicadores derivados de apontamento mostravam
-- número sem sentido quando NÃO há base de apontamento real no mês:
--   • RHT (receita/hora): com 0,03 h apontada e R$ 22.943 de receita → 764.777 R$/h (piloto Pdois).
--   • MRA (margem real): com custo 0 (nenhuma hora apontada) → 100% em TODA empresa sem apontamento.
-- Doutrina do painel (RD-51/RD-95): indicador sem base suficiente = "em cálculo"
-- (dados insuficientes), nunca número falso. Esta migration é só CREATE OR REPLACE da RPC:
-- RHT e MRA passam a exigir base de apontamento real; demais indicadores inalterados.
-- Aditiva e idempotente (CREATE OR REPLACE). Sem mudança de assinatura, RLS ou grants.

CREATE OR REPLACE FUNCTION public.fn_pm_bi_indicadores(p_company_ids uuid[])
 RETURNS TABLE(sigla text, nome text, meta_numerica numeric, meta_unidade text, direcao_boa text, valor_calculado numeric, status_semaforo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH met AS (
    SELECT
      (SELECT COALESCE(sum(valor_mensal),0) FROM erp_contratos
        WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL) AS receita_mes,
      (SELECT COALESCE(sum(horas),0) FROM agency_timesheet
        WHERE company_id=ANY(p_company_ids) AND data >= date_trunc('month',current_date)::date) AS horas_mes,
      (SELECT COALESCE(sum(custo_total),0) FROM agency_timesheet
        WHERE company_id=ANY(p_company_ids) AND data >= date_trunc('month',current_date)::date) AS custo_mes,
      (SELECT count(*) FROM agency_jobs
        WHERE company_id=ANY(p_company_ids) AND data_entrega IS NOT NULL
          AND excluido_em IS NULL) AS jobs_entregues,
      (SELECT count(*) FROM agency_jobs
        WHERE company_id=ANY(p_company_ids) AND data_entrega IS NOT NULL
          AND data_prazo IS NOT NULL AND data_entrega <= data_prazo
          AND excluido_em IS NULL) AS jobs_prazo,
      (SELECT AVG( GREATEST(0, (current_date - data_inicio)) / 30.0 ) FROM erp_contratos
        WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL AND data_inicio IS NOT NULL) AS vida_meses
  ),
  comp AS (
    -- RHT precisa de base de apontamento real (>= 1 h no mês); senão fica "em cálculo".
    SELECT 'RHT'::text AS sigla, CASE WHEN m.horas_mes >= 1 THEN round(m.receita_mes/m.horas_mes,2) END AS valor FROM met m
    -- MRA (margem) exige custo apontado real (horas >= 1 e custo > 0); custo 0 não é margem 100%, é falta de dado.
    UNION ALL SELECT 'MRA', CASE WHEN m.horas_mes >= 1 AND m.custo_mes > 0 AND m.receita_mes > 0 THEN round((m.receita_mes-m.custo_mes)/m.receita_mes*100,1) END FROM met m
    UNION ALL SELECT 'OTDR', CASE WHEN m.jobs_entregues>0 THEN round(m.jobs_prazo::numeric/m.jobs_entregues*100,1) END FROM met m
    UNION ALL SELECT 'VUCB', CASE WHEN m.vida_meses IS NOT NULL THEN round(m.vida_meses,1) END FROM met m
    UNION ALL SELECT 'HSC', NULL::numeric FROM met m
    UNION ALL SELECT 'TRI', NULL::numeric FROM met m
  )
  SELECT c.sigla, c.nome, c.meta_numerica, c.meta_unidade, COALESCE(c.direcao_boa,'maior'),
    comp.valor,
    CASE
      WHEN comp.valor IS NULL THEN 'em_calculo'
      WHEN (COALESCE(c.direcao_boa,'maior')='maior' AND comp.valor >= c.meta_numerica)
        OR (c.direcao_boa='menor' AND comp.valor <= c.meta_numerica) THEN 'verde'
      WHEN (COALESCE(c.direcao_boa,'maior')='maior' AND comp.valor >= c.meta_numerica*0.8)
        OR (c.direcao_boa='menor' AND comp.valor <= c.meta_numerica*1.2) THEN 'amarelo'
      ELSE 'vermelho'
    END AS status_semaforo
  FROM area_indicadores_mestres c
  JOIN comp ON comp.sigla = c.sigla
  WHERE c.area='pm' AND c.bloco='agencia'
  ORDER BY c.sigla;
END $function$;

-- Reafirma a ACL viva (check_fn_guards: todo CREATE OR REPLACE de SECURITY DEFINER
-- precisa repetir o REVOKE anon/PUBLIC no texto; grants idênticos ao vivo).
REVOKE ALL ON FUNCTION public.fn_pm_bi_indicadores(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_indicadores(uuid[]) TO authenticated, service_role;
