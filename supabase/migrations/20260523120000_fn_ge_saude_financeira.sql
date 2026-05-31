-- PR 2 · Função 1/6 do Dashboard Rico GE.
-- Score 0-100 de saúde financeira + 3 frases explicativas.
-- Universal RD-38: requer subscription v15_gestao_empresarial_pro ativa.
-- Nota: erp_lancamentos.data_* são text — cast `NULLIF(...,'')::date` em
-- todas as comparações com CURRENT_DATE.

CREATE OR REPLACE FUNCTION public.fn_ge_saude_financeira(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_saldo_total numeric := 0;
  v_a_receber_30d numeric := 0;
  v_a_pagar_30d numeric := 0;
  v_burn_rate_mensal numeric := 0;
  v_meses_caixa numeric := 0;
  v_concentracao_pct numeric := 0;
  v_top_cliente_nome text;
  v_inadimplencia_pct numeric := 0;
  v_score int := 0;
  v_classificacao text;
  v_frase_1 text;
  v_frase_2 text;
  v_frase_3 text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true, 'mensagem', 'Empresa sem plano GE ativo');
  END IF;

  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_saldo_total
  FROM erp_banco_contas WHERE company_id = p_company_id;

  SELECT COALESCE(SUM(valor_documento), 0) INTO v_a_receber_30d
  FROM erp_lancamentos
  WHERE company_id = p_company_id
    AND tipo = 'receber'
    AND status != 'pago'
    AND NULLIF(data_vencimento,'')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30;

  SELECT COALESCE(SUM(valor_documento), 0) INTO v_a_pagar_30d
  FROM erp_lancamentos
  WHERE company_id = p_company_id
    AND tipo = 'pagar'
    AND status != 'pago'
    AND NULLIF(data_vencimento,'')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30;

  SELECT COALESCE(AVG(total_mes), 0) INTO v_burn_rate_mensal
  FROM (
    SELECT DATE_TRUNC('month', NULLIF(data_pagamento,'')::date) AS mes,
           SUM(valor_pago) AS total_mes
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo = 'pagar'
      AND status = 'pago'
      AND NULLIF(data_pagamento,'')::date >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY DATE_TRUNC('month', NULLIF(data_pagamento,'')::date)
  ) sub;

  IF v_burn_rate_mensal > 0 THEN
    v_meses_caixa := ROUND(v_saldo_total / v_burn_rate_mensal, 1);
  ELSE
    v_meses_caixa := 0;
  END IF;

  WITH receitas_por_cliente AS (
    SELECT cliente_id, nome_pessoa, SUM(valor_pago) AS total
    FROM erp_lancamentos
    WHERE company_id = p_company_id
      AND tipo = 'receber'
      AND status = 'pago'
      AND NULLIF(data_pagamento,'')::date >= CURRENT_DATE - INTERVAL '90 days'
      AND cliente_id IS NOT NULL
    GROUP BY cliente_id, nome_pessoa
  ),
  totais AS (
    SELECT SUM(total) AS total_geral FROM receitas_por_cliente
  )
  SELECT nome_pessoa, ROUND((total / NULLIF(total_geral, 0)) * 100, 0)
  INTO v_top_cliente_nome, v_concentracao_pct
  FROM receitas_por_cliente, totais
  ORDER BY total DESC LIMIT 1;

  v_concentracao_pct := COALESCE(v_concentracao_pct, 0);

  WITH receber_status AS (
    SELECT SUM(CASE WHEN NULLIF(data_vencimento,'')::date < CURRENT_DATE AND status != 'pago' THEN valor_documento ELSE 0 END) AS vencido,
           SUM(valor_documento) AS total
    FROM erp_lancamentos
    WHERE company_id = p_company_id AND tipo = 'receber'
  )
  SELECT ROUND((vencido / NULLIF(total, 0)) * 100, 0) INTO v_inadimplencia_pct
  FROM receber_status;

  v_inadimplencia_pct := COALESCE(v_inadimplencia_pct, 0);

  v_score := LEAST(100, GREATEST(0,
    LEAST(40, ROUND(v_meses_caixa * 7))::int +
    GREATEST(0, 30 - (v_inadimplencia_pct * 0.5))::int +
    GREATEST(0, 30 - (v_concentracao_pct * 0.3))::int
  ));

  v_classificacao := CASE
    WHEN v_score >= 70 THEN 'BOA'
    WHEN v_score >= 40 THEN 'ATENÇÃO'
    ELSE 'CRÍTICA'
  END;

  v_frase_1 := CASE
    WHEN v_meses_caixa = 0 THEN 'Sem dados suficientes pra calcular meses de caixa'
    WHEN v_meses_caixa >= 6 THEN 'Caixa cobre ' || v_meses_caixa || ' meses de operação'
    WHEN v_meses_caixa >= 3 THEN 'Caixa cobre ' || v_meses_caixa || ' meses (atenção)'
    ELSE 'Caixa cobre só ' || v_meses_caixa || ' meses (crítico)'
  END;

  v_frase_2 := CASE
    WHEN v_top_cliente_nome IS NULL THEN 'Sem cliente concentrando faturamento'
    WHEN v_concentracao_pct >= 50 THEN 'Risco alto: ' || v_top_cliente_nome || ' concentra ' || v_concentracao_pct || '% da receita'
    WHEN v_concentracao_pct >= 30 THEN 'Atenção: ' || v_top_cliente_nome || ' concentra ' || v_concentracao_pct || '% da receita'
    ELSE 'Carteira diversificada (concentração ' || v_concentracao_pct || '%)'
  END;

  v_frase_3 := CASE
    WHEN v_inadimplencia_pct = 0 THEN 'Inadimplência zerada'
    WHEN v_inadimplencia_pct <= 5 THEN 'Inadimplência baixa em ' || v_inadimplencia_pct || '%'
    WHEN v_inadimplencia_pct <= 15 THEN 'Inadimplência em ' || v_inadimplencia_pct || '% (atenção)'
    ELSE 'Inadimplência alta em ' || v_inadimplencia_pct || '% (crítico)'
  END;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'score', v_score,
    'classificacao', v_classificacao,
    'cor_semaforo', CASE WHEN v_score >= 70 THEN 'verde'
                         WHEN v_score >= 40 THEN 'amarelo'
                         ELSE 'vermelho' END,
    'frases', jsonb_build_array(v_frase_1, v_frase_2, v_frase_3),
    'metricas_brutas', jsonb_build_object(
      'saldo_total', v_saldo_total,
      'meses_caixa', v_meses_caixa,
      'concentracao_pct', v_concentracao_pct,
      'top_cliente_nome', v_top_cliente_nome,
      'inadimplencia_pct', v_inadimplencia_pct,
      'burn_rate_mensal', v_burn_rate_mensal
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_saude_financeira(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_saude_financeira(uuid) IS
'Saúde financeira 0-100. Universal RD-38. PR 2 23/05/2026.';
