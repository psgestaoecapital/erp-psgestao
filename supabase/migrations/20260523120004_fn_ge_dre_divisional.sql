-- PR 2 · Função 5/6: DRE Divisional do mês atual (realizado vs orçado por linha).
-- IPO #35: linhas_negocio usa coluna `empresa_id`, não `company_id`.

CREATE OR REPLACE FUNCTION public.fn_ge_dre_divisional(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mes int := EXTRACT(MONTH FROM CURRENT_DATE);
  v_ano int := EXTRACT(YEAR FROM CURRENT_DATE);
  v_linhas jsonb;
  v_total_realizado numeric := 0;
  v_total_orcado numeric := 0;
  v_pct_geral numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM linhas_negocio
    WHERE empresa_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'empty_state', true,
      'mensagem', 'Empresa sem linhas de negocio configuradas (DRE Divisional opcional)'
    );
  END IF;

  WITH realizado AS (
    SELECT
      ln.id AS linha_id,
      ln.nome AS linha_nome,
      COALESCE(SUM(d.receita_bruta), 0) AS receita_realizada
    FROM linhas_negocio ln
    LEFT JOIN m2_dre_divisional d ON d.ln_id = ln.id AND d.year = v_ano AND d.month = v_mes
    WHERE ln.empresa_id = p_company_id
    GROUP BY ln.id, ln.nome
  ),
  orcado AS (
    SELECT
      linha_id,
      COALESCE(SUM(receita_budget), 0) AS receita_orcada
    FROM linhas_negocio_budget
    WHERE empresa_id = p_company_id AND ano = v_ano AND mes = v_mes
    GROUP BY linha_id
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'linha_id', r.linha_id,
        'linha_nome', r.linha_nome,
        'realizado', r.receita_realizada,
        'orcado', COALESCE(o.receita_orcada, 0),
        'pct_atingido', CASE
          WHEN COALESCE(o.receita_orcada, 0) = 0 THEN NULL
          ELSE ROUND((r.receita_realizada / o.receita_orcada) * 100, 0)
        END,
        'status', CASE
          WHEN COALESCE(o.receita_orcada, 0) = 0 THEN 'sem_orcamento'
          WHEN r.receita_realizada / o.receita_orcada >= 0.9 THEN 'verde'
          WHEN r.receita_realizada / o.receita_orcada >= 0.7 THEN 'amarelo'
          ELSE 'vermelho'
        END
      )
      ORDER BY r.linha_nome
    ), '[]'::jsonb),
    SUM(r.receita_realizada),
    SUM(COALESCE(o.receita_orcada, 0))
  INTO v_linhas, v_total_realizado, v_total_orcado
  FROM realizado r
  LEFT JOIN orcado o ON o.linha_id = r.linha_id;

  v_pct_geral := CASE WHEN COALESCE(v_total_orcado, 0) = 0 THEN NULL
                       ELSE ROUND((v_total_realizado / v_total_orcado) * 100, 0) END;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'mes', v_mes,
    'ano', v_ano,
    'linhas', v_linhas,
    'total_realizado', COALESCE(v_total_realizado, 0),
    'total_orcado', COALESCE(v_total_orcado, 0),
    'pct_geral', v_pct_geral
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_dre_divisional(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_dre_divisional(uuid) IS
'DRE Divisional do mes atual. Universal RD-38. PR 2 23/05/2026.';
