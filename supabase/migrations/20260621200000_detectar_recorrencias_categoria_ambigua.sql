-- FIX: detectar_recorrencias · "categoria" era ambigua entre as colunas
-- erp_pagar/receber e o OUT param do RETURNS TABLE · qualificar com
-- nome da tabela no SELECT do UNION ALL resolve.
--
-- Mesma logica do PR #415 · so muda os 2 SELECTs internos.

CREATE OR REPLACE FUNCTION public.detectar_recorrencias(p_company_id uuid)
RETURNS TABLE(descricao_padrao character varying, dia_mes integer, valor_medio numeric,
              tipo character varying, ocorrencias integer, ultima_ocorrencia date,
              categoria character varying)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH historico AS (
    SELECT
      UPPER(TRIM(REGEXP_REPLACE(
        SUBSTRING(e.descricao FROM 1 FOR 50),
        '\d+[/-]\d+[/-]?\d*', '', 'g'
      ))) AS desc_norm,
      EXTRACT(DAY FROM e.data_vencimento)::int AS dia,
      e.valor          AS vl,
      e.tipo           AS tp,
      e.data_vencimento AS dt_venc,
      e.categoria      AS cat
    FROM (
      SELECT descricao, data_vencimento, valor, 'despesa'::varchar AS tipo, erp_pagar.categoria
        FROM erp_pagar
        WHERE company_id = p_company_id
          AND status = 'pago'
          AND data_vencimento IS NOT NULL
      UNION ALL
      SELECT descricao, data_vencimento, valor, 'receita'::varchar AS tipo, erp_receber.categoria
        FROM erp_receber
        WHERE company_id = p_company_id
          AND status = 'pago'
          AND data_vencimento IS NOT NULL
    ) e
  )
  SELECT
    h.desc_norm::varchar,
    h.dia,
    AVG(h.vl)::decimal(14,2),
    MODE() WITHIN GROUP (ORDER BY h.tp)::varchar,
    count(*)::int,
    MAX(h.dt_venc),
    MODE() WITHIN GROUP (ORDER BY h.cat)::varchar
  FROM historico h
  WHERE h.dt_venc IS NOT NULL
    AND h.dt_venc >= CURRENT_DATE - interval '12 months'
    AND h.dt_venc <  CURRENT_DATE
  GROUP BY h.desc_norm, h.dia
  HAVING count(*) >= 3
     AND MAX(h.dt_venc) >= CURRENT_DATE - interval '60 days'
  ORDER BY count(*) DESC;
END;
$function$;
