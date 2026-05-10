-- PR 4.6 v2: corrigir colunas reais erp_compras (nf_numero, total)
CREATE OR REPLACE FUNCTION public.fn_truth_audit_compras()
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
  UPDATE erp_truth_alerts
  SET status = 'ignorado',
      notas_resolucao = 'Re-executado em ' || NOW()::text
  WHERE rule_id = 'compras_nf_entrada_vinculada' AND status = 'novo';

  WITH compras_sem_nf AS (
    SELECT
      c.company_id,
      EXTRACT(YEAR FROM c.data_pedido)::int AS ano,
      EXTRACT(MONTH FROM c.data_pedido)::int AS mes,
      COUNT(*) AS qtd_compras_sem_nf,
      SUM(c.total) AS valor_total
    FROM erp_compras c
    WHERE c.total > 100
      AND (c.nf_numero IS NULL OR c.nf_numero = '' OR c.nf_numero = '-')
      AND c.data_pedido IS NOT NULL
    GROUP BY c.company_id, EXTRACT(YEAR FROM c.data_pedido), EXTRACT(MONTH FROM c.data_pedido)
  )
  INSERT INTO erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia,
    valor_esperado, valor_encontrado, delta_percentual,
    periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at
  )
  SELECT
    'compras_nf_entrada_vinculada',
    cn.company_id,
    CASE
      WHEN cn.valor_total > 50000 THEN 'critical'
      WHEN cn.valor_total > 10000 THEN 'warn'
      ELSE 'info'
    END,
    'compras',
    'compra_sem_nf',
    cn.valor_total,
    0,
    100,
    DATE(cn.ano || '-' || LPAD(cn.mes::text, 2, '0') || '-01'),
    (DATE(cn.ano || '-' || LPAD(cn.mes::text, 2, '0') || '-01') + INTERVAL '1 month - 1 day')::date,
    jsonb_build_object(
      'periodo', cn.ano || '-' || LPAD(cn.mes::text, 2, '0'),
      'qtd_compras_sem_nf', cn.qtd_compras_sem_nf,
      'valor_total_R$', cn.valor_total
    ),
    CONCAT(cn.qtd_compras_sem_nf, ' compras sem NF totalizam R$ ',
           ROUND(cn.valor_total::numeric, 2), ' em ', cn.ano, '-', LPAD(cn.mes::text, 2, '0')),
    'Regularizar emissao/anexacao de NF para essas compras (compliance fiscal)',
    'novo',
    NOW()
  FROM compras_sem_nf cn;

  GET DIAGNOSTICS v_alertas = ROW_COUNT;

  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity = 'critical')
  INTO v_empresas, v_criticas
  FROM erp_truth_alerts
  WHERE rule_id = 'compras_nf_entrada_vinculada' AND status = 'novo';

  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $func$;
