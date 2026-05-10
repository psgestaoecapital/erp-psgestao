-- PR 4.5 (cont): RPC Truth Auditor DRE - regra critica funcional
CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre()
RETURNS TABLE (
  alertas_gerados integer,
  empresas_auditadas integer,
  divergencias_criticas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_alertas INT := 0;
  v_empresas INT := 0;
  v_criticas INT := 0;
BEGIN
  -- Idempotencia: expira alertas anteriores
  UPDATE erp_truth_alerts
  SET status = 'expirado',
      notas_resolucao = 'Re-executado por fn_truth_audit_dre em ' || NOW()::text
  WHERE rule_id = 'dre_receita_bate_nfs'
    AND status = 'aberto';

  -- Compara receita real (erp_receber) vs PSGC competencia (apenas codigos receita 1.x e 3.x)
  WITH receita_real AS (
    SELECT
      r.company_id,
      EXTRACT(YEAR FROM r.data_emissao)::int AS ano,
      EXTRACT(MONTH FROM r.data_emissao)::int AS mes,
      SUM(r.valor) AS valor_real
    FROM erp_receber r
    WHERE r.valor > 0 AND r.data_emissao IS NOT NULL
    GROUP BY r.company_id, EXTRACT(YEAR FROM r.data_emissao), EXTRACT(MONTH FROM r.data_emissao)
  ),
  receita_psgc AS (
    SELECT
      company_id, ano, mes,
      SUM(valor) AS valor_psgc
    FROM psgc_dre
    WHERE regime = 'competencia'
      AND source = 'pr_4_4_re_etl_receita'
    GROUP BY company_id, ano, mes
  ),
  comparacao AS (
    SELECT
      r.company_id, r.ano, r.mes,
      r.valor_real,
      COALESCE(p.valor_psgc, 0) AS valor_psgc,
      r.valor_real - COALESCE(p.valor_psgc, 0) AS delta_abs,
      CASE
        WHEN r.valor_real > 0 THEN
          ABS((r.valor_real - COALESCE(p.valor_psgc, 0)) / r.valor_real) * 100
        ELSE 0
      END AS delta_pct
    FROM receita_real r
    LEFT JOIN receita_psgc p ON p.company_id = r.company_id
      AND p.ano = r.ano AND p.mes = r.mes
  )
  INSERT INTO erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia,
    valor_esperado, valor_encontrado, delta_absoluto, delta_percentual,
    periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status,
    detected_at
  )
  SELECT
    'dre_receita_bate_nfs',
    c.company_id,
    CASE
      WHEN c.delta_pct > 10 OR ABS(c.delta_abs) > 50000 THEN 'critica'
      WHEN c.delta_pct > 5 OR ABS(c.delta_abs) > 10000 THEN 'alta'
      WHEN c.delta_pct > 1 OR ABS(c.delta_abs) > 1000 THEN 'media'
      ELSE 'baixa'
    END,
    'dre',
    'receita_bruta_divergente',
    c.valor_real,
    c.valor_psgc,
    c.delta_abs,
    c.delta_pct,
    DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01'),
    (DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01') + INTERVAL '1 month - 1 day')::date,
    jsonb_build_object(
      'periodo', c.ano || '-' || LPAD(c.mes::text, 2, '0'),
      'valor_real_erp_receber', c.valor_real,
      'valor_psgc_dre', c.valor_psgc,
      'delta_pct', ROUND(c.delta_pct::numeric, 2),
      'metodo', 'fn_truth_audit_dre comparacao mensal'
    ),
    CONCAT(
      'Divergencia R$ ', ROUND(ABS(c.delta_abs)::numeric, 2),
      ' (', ROUND(c.delta_pct::numeric, 1), '%) na receita ',
      c.ano, '-', LPAD(c.mes::text, 2, '0')
    ),
    CASE
      WHEN c.valor_psgc = 0 THEN 'Re-executar PR 4.4 - psgc_dre vazio para periodo'
      WHEN c.delta_pct > 10 THEN 'Investigar divergencia critica - gap mapeamento ou bug ETL'
      WHEN c.delta_pct > 1 THEN 'Verificar se empresa lanca transferencias/vendas-ativos em erp_receber'
      ELSE 'Diferenca menor que 1% - dentro tolerancia'
    END,
    'aberto',
    NOW()
  FROM comparacao c
  WHERE ABS(c.delta_pct) > 1 OR ABS(c.delta_abs) > 1000;

  GET DIAGNOSTICS v_alertas = ROW_COUNT;

  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity = 'critica')
  INTO v_empresas, v_criticas
  FROM erp_truth_alerts
  WHERE rule_id = 'dre_receita_bate_nfs' AND status = 'aberto';

  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $func$;

COMMENT ON FUNCTION public.fn_truth_audit_dre() IS
'Truth Auditor DRE: valida receita PSGC vs erp_receber. Gera alertas em erp_truth_alerts. PR 4.5.';
