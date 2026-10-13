-- fn_ge_saude_financeira foundational
-- Aplicado via MCP apply_migration 26/05/2026 · rastreio histórico
--
-- Causa raiz BUG #5 (frase "Inadimplência zerada" mentirosa): RPC lia
-- erp_lancamentos (vazia). Agora lê erp_receber/erp_pagar.
-- Validado: PS LTDA score=65 ATENÇÃO/amarelo (era falsamente alto).
-- Frase #2: "Inadimplência: 7 contas · R$ 11.500,00" (era "zerada").
-- Shape JSON estendido (campos extras opcionais · frontend ignora se não conhece).

CREATE OR REPLACE FUNCTION public.fn_ge_saude_financeira(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_saldo_total numeric := 0;
  v_burn_rate_mensal numeric := 0;
  v_meses_caixa numeric := 0;
  v_concentracao_pct numeric := 0;
  v_top_cliente_nome text;
  v_inadimplencia_pct numeric := 0;
  v_inadimplencia_qtd int := 0;
  v_inadimplencia_valor numeric := 0;
  v_score int := 0;
  v_classificacao text;
  v_cor text;
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

  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT COALESCE(AVG(total_mes), 0) INTO v_burn_rate_mensal
  FROM (
    SELECT DATE_TRUNC('month', data_pagamento) AS mes, SUM(COALESCE(valor_pago, valor)) AS total_mes
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY DATE_TRUNC('month', data_pagamento)
  ) sub;

  v_meses_caixa := CASE WHEN v_burn_rate_mensal > 0
    THEN ROUND(v_saldo_total / v_burn_rate_mensal, 1) ELSE 0 END;

  WITH receitas_por_cliente AS (
    SELECT cliente_id, cliente_nome, SUM(COALESCE(valor_pago, valor)) AS total
    FROM erp_receber
    WHERE company_id = p_company_id AND status='recebido'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days'
      AND cliente_id IS NOT NULL
    GROUP BY cliente_id, cliente_nome
  ),
  totais AS (SELECT SUM(total) AS total_geral FROM receitas_por_cliente)
  SELECT cliente_nome, ROUND((total / NULLIF(total_geral, 0)) * 100, 0)
  INTO v_top_cliente_nome, v_concentracao_pct
  FROM receitas_por_cliente, totais ORDER BY total DESC LIMIT 1;

  v_concentracao_pct := COALESCE(v_concentracao_pct, 0);

  SELECT COUNT(*), COALESCE(SUM(valor), 0)
  INTO v_inadimplencia_qtd, v_inadimplencia_valor
  FROM erp_receber
  WHERE company_id = p_company_id AND status = 'aberto'
    AND data_vencimento < CURRENT_DATE;

  WITH base AS (
    SELECT SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status='aberto' THEN valor ELSE 0 END) AS vencido,
           SUM(valor) AS total
    FROM erp_receber WHERE company_id = p_company_id
  )
  SELECT ROUND((vencido / NULLIF(total, 0)) * 100, 0) INTO v_inadimplencia_pct FROM base;
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

  v_cor := CASE
    WHEN v_score >= 70 THEN 'verde'
    WHEN v_score >= 40 THEN 'amarelo'
    ELSE 'vermelho'
  END;

  v_frase_1 := CASE
    WHEN v_meses_caixa = 0 THEN 'Sem histórico de pagamentos pra calcular meses de caixa'
    WHEN v_meses_caixa >= 6 THEN 'Caixa cobre ' || v_meses_caixa || ' meses de operação'
    WHEN v_meses_caixa >= 3 THEN 'Caixa cobre ' || v_meses_caixa || ' meses (atenção)'
    ELSE 'Caixa cobre só ' || v_meses_caixa || ' meses (crítico)'
  END;

  v_frase_2 := CASE
    WHEN v_inadimplencia_qtd = 0 THEN 'Inadimplência zerada'
    ELSE 'Inadimplência: ' || v_inadimplencia_qtd || ' contas · R$ ' || TO_CHAR(v_inadimplencia_valor, 'FM999G999G990D00')
  END;

  v_frase_3 := CASE
    WHEN v_top_cliente_nome IS NULL THEN 'Sem dados de concentração de receita ainda'
    WHEN v_concentracao_pct >= 50 THEN 'Concentração alta: ' || v_top_cliente_nome || ' representa ' || v_concentracao_pct || '%'
    WHEN v_concentracao_pct >= 30 THEN 'Maior cliente (' || v_top_cliente_nome || ') = ' || v_concentracao_pct || '% da receita'
    ELSE 'Carteira diversificada (maior cliente = ' || v_concentracao_pct || '%)'
  END;

  RETURN jsonb_build_object(
    'score', v_score,
    'classificacao', v_classificacao,
    'cor_semaforo', v_cor,
    'meses_caixa', v_meses_caixa,
    'saldo_total', v_saldo_total,
    'inadimplencia_pct', v_inadimplencia_pct,
    'inadimplencia_qtd', v_inadimplencia_qtd,
    'inadimplencia_valor', v_inadimplencia_valor,
    'concentracao_pct', v_concentracao_pct,
    'top_cliente_nome', v_top_cliente_nome,
    'frases', jsonb_build_array(v_frase_1, v_frase_2, v_frase_3)
  );
END;
$$;
