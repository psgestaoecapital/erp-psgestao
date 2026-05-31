-- PR 2 · Função 4/6: top N clientes com maiores atrasos.
-- IPO #35: cast text→date em data_vencimento.

CREATE OR REPLACE FUNCTION public.fn_ge_top_inadimplentes(p_company_id uuid, p_limit int DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_top jsonb;
  v_total_atrasados int;
  v_total_valor numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH atrasados AS (
    SELECT
      l.cliente_id,
      l.nome_pessoa,
      MAX(CURRENT_DATE - NULLIF(l.data_vencimento,'')::date) AS dias_max_atraso,
      SUM(l.valor_documento) AS valor_total,
      COUNT(*) AS qtd_lancamentos
    FROM erp_lancamentos l
    WHERE l.company_id = p_company_id
      AND l.tipo = 'receber'
      AND l.status != 'pago'
      AND NULLIF(l.data_vencimento,'')::date < CURRENT_DATE
    GROUP BY l.cliente_id, l.nome_pessoa
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'cliente_id', cliente_id,
        'nome', nome_pessoa,
        'iniciais', UPPER(LEFT(SPLIT_PART(nome_pessoa, ' ', 1), 1) || COALESCE(LEFT(SPLIT_PART(nome_pessoa, ' ', 2), 1), '')),
        'dias_atraso', dias_max_atraso,
        'valor_total', valor_total,
        'qtd_lancamentos', qtd_lancamentos,
        'score', NULL
      )
      ORDER BY dias_max_atraso DESC
    ), '[]'::jsonb),
    COUNT(*)::int,
    COALESCE(SUM(valor_total), 0)
  INTO v_top, v_total_atrasados, v_total_valor
  FROM (
    SELECT * FROM atrasados ORDER BY dias_max_atraso DESC LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'top', v_top,
    'total_atrasados', v_total_atrasados,
    'total_valor', v_total_valor,
    'qtd_total_clientes_atrasados', (
      SELECT COUNT(DISTINCT cliente_id)
      FROM erp_lancamentos
      WHERE company_id = p_company_id
        AND tipo = 'receber'
        AND status != 'pago'
        AND NULLIF(data_vencimento,'')::date < CURRENT_DATE
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_top_inadimplentes(uuid, int) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_top_inadimplentes(uuid, int) IS
'Top N clientes com maiores atrasos. Universal RD-38. PR 2 23/05/2026.';
