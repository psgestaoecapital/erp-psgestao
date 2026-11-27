-- fn_ge_extrato_conta — corretude de NÚCLEO (go-live): ignorar título soft-deletado
--
-- PDCA auditor_pdca_2 (25/11), tela /dashboard/financeiro/extrato (jornada 5 — Financeiro › Extrato/Conciliação).
-- GAP (RD-38, provado no dado): a função NÃO filtrava deleted_at IS NULL em NENHUMA consulta a
-- erp_receber/erp_pagar. Título soft-deletado (deleted_at IS NOT NULL) com status recebido/pago
-- era contado como entrada/saída de caixa — tanto nos totalizadores (saldo_anterior, total_entradas,
-- total_saidas, saldo_atual) quanto nas LINHAS visíveis do extrato.
--
-- PROVA RD-38 na DEMO GE (b0700000-0000-4000-a000-000000000004), all-time ANTES deste fix:
--   receber: vivo (deleted_at IS NULL) = R$ 3.530,00 · fantasma (soft-deletado contado) = R$ 64.000.000.564.352,46 em 33.639 títulos
--   pagar  : vivo                      = R$ 34.069,16 · fantasma                          = R$ 64.000.004.607.053,04 em 13.218 títulos
-- Afeta empresas REAIS que soft-deletam título já pago, não só a DEMO (mesma classe de fn_caixa_grupo_mes,
-- fn_ge_kpis_dashboard, fn_balanco_patrimonial e fn_fluxo_caixa_diario).
--
-- CORREÇÃO: patch aditivo — adiciona AND deleted_at IS NULL em TODAS as 10 consultas a erp_receber/erp_pagar.
-- Sem mudança de assinatura, sem UPDATE/DELETE, sem tocar dado de cliente. CREATE OR REPLACE (sensível/revisada).

CREATE OR REPLACE FUNCTION public.fn_ge_extrato_conta(p_company_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_data_inicio date := COALESCE(p_data_inicio, CURRENT_DATE - 30);
  v_data_fim date := COALESCE(p_data_fim, CURRENT_DATE);
  v_saldo_base numeric := 0;
  v_data_ancora date;
  v_saldo_anterior numeric := 0;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_c_inicio numeric := 0;
  v_c_ancora numeric := 0;
  v_conta_nome text := NULL;
  v_resultados jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  -- Conta selecionada: resolve o NOME (vínculo de erp_pagar.conta_bancaria é por nome) e já valida
  -- que a conta pertence à empresa. p_conta_id NULL = empresa inteira (v_conta_nome permanece NULL).
  IF p_conta_id IS NOT NULL THEN
    SELECT nome INTO v_conta_nome
      FROM erp_banco_contas
      WHERE id = p_conta_id AND company_id = p_company_id;
  END IF;

  SELECT COALESCE(SUM(saldo_inicial),0), MIN(data_saldo_inicial)
    INTO v_saldo_base, v_data_ancora
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo AND soma_no_saldo
    AND (p_conta_id IS NULL OR id = p_conta_id);

  IF v_data_ancora IS NULL THEN
    -- Sem data de âncora: o saldo de abertura vale desde sempre. Saldo no início do período =
    -- abertura + (recebidos antes do início) − (pagos antes do início).
    SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_c_inicio
      FROM erp_receber
      WHERE company_id = p_company_id AND status IN ('recebido','pago') AND data_pagamento < v_data_inicio
        AND deleted_at IS NULL
        AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome));
    SELECT v_saldo_base + v_c_inicio - COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_saldo_anterior
      FROM erp_pagar
      WHERE company_id = p_company_id AND status = 'pago' AND data_pagamento < v_data_inicio
        AND deleted_at IS NULL
        AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome);
  ELSE
    v_c_inicio :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_inicio - 1
            AND deleted_at IS NULL
            AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome)))
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_inicio - 1
            AND deleted_at IS NULL
            AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome));
    v_c_ancora :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_ancora
            AND deleted_at IS NULL
            AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome)))
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_ancora
            AND deleted_at IS NULL
            AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome));
    v_saldo_anterior := v_saldo_base + v_c_inicio - v_c_ancora;
  END IF;

  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_entradas
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND deleted_at IS NULL
      AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome));
  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_saidas
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND deleted_at IS NULL
      AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome);

  WITH movimentos AS (
    SELECT id, 'receita' AS tipo, descricao, cliente_nome AS nome_pessoa, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor) AS valor,
      data_pagamento AS data, COALESCE(valor_pago, valor) AS sinal
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND deleted_at IS NULL
      AND COALESCE(valor_pago, valor) <> 0
      AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome))
    UNION ALL
    SELECT id, 'despesa', descricao, fornecedor_nome, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor),
      data_pagamento, -COALESCE(valor_pago, valor)
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND deleted_at IS NULL
      AND COALESCE(valor_pago, valor) <> 0
      AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome)
  ),
  com_saldo AS (
    SELECT *, v_saldo_anterior + SUM(sinal) OVER (ORDER BY data, id ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
    FROM movimentos
  )
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.data DESC, a.id DESC) INTO v_resultados FROM com_saldo a;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_data_inicio, 'fim', v_data_fim),
    'totalizadores', jsonb_build_object(
      'saldo_anterior', v_saldo_anterior,
      'total_entradas', v_total_entradas,
      'total_saidas', v_total_saidas,
      'saldo_atual', v_saldo_anterior + v_total_entradas - v_total_saidas,
      'saldo_base', v_saldo_base,
      'data_ancora', v_data_ancora
    ),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END;
$function$;

-- Guarda de ACL (gate check:fn-guards): reafirma a ACL viva (sem anon/public), sem mudar comportamento.
REVOKE ALL ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) TO authenticated, service_role;
