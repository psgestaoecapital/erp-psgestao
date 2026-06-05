-- =============================================================
-- FIX-FINANCEIRO-VALORPAGO-v1 · NULLIF no COALESCE de valor_pago
-- =============================================================
-- Problema: lancamentos espelhados do Omie tem valor_pago=0 (nao null)
-- + status='pago'. COALESCE(valor_pago, valor) retorna 0 nesse caso.
-- Fix: COALESCE(NULLIF(valor_pago, 0), valor) ignora o 0 e usa valor.
--
-- Afetadas: fn_ge_listagem_v2 (KPIs Recebidas/Pagas) +
--           fn_fluxo_caixa_diario (linhas recebimentos/pagamentos).
-- Nao toca dado · so o calculo de exibicao.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(
  p_company_id uuid,
  p_tipo text,
  p_data_inicio date,
  p_data_fim date,
  p_status_filtro text DEFAULT 'todos'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb;
  v_hoje date := CURRENT_DATE;
  v_kpi_vencidos numeric; v_kpi_hoje numeric; v_kpi_avencer numeric; v_kpi_pagos numeric; v_kpi_total numeric;
  v_cnt_vencidos int; v_cnt_hoje int; v_cnt_avencer int; v_cnt_pagos int;
BEGIN
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas inválidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status != 'pago' THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status != 'pago' THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status != 'pago' THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status != 'pago'),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status != 'pago'),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status != 'pago'),
      COUNT(*) FILTER (WHERE status = 'pago')
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total,
         v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_pagar
    WHERE company_id = p_company_id
      AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT id, descricao, fornecedor_nome AS nome_pessoa, categoria,
        valor AS valor_documento, valor_pago, data_vencimento, data_pagamento,
        status, numero_documento, forma_pagamento,
        CASE WHEN status = 'pago' THEN 'pago'
             WHEN data_vencimento < v_hoje THEN 'vencido'
             WHEN data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM erp_pagar
      WHERE company_id = p_company_id
        AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND (p_status_filtro = 'todos'
          OR (p_status_filtro = 'vencidos' AND data_vencimento < v_hoje AND status != 'pago')
          OR (p_status_filtro = 'hoje' AND data_vencimento = v_hoje AND status != 'pago')
          OR (p_status_filtro = 'avencer' AND data_vencimento > v_hoje AND status != 'pago')
          OR (p_status_filtro = 'pagos' AND status = 'pago'))
      ORDER BY data_vencimento ASC, descricao
      LIMIT 500
    ) a;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('recebido','pago') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status IN ('recebido','pago') THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE status IN ('recebido','pago'))
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total,
         v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_receber
    WHERE company_id = p_company_id
      AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      AND COALESCE(status, '') != 'orcamento';

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT id, descricao, cliente_nome AS nome_pessoa, categoria,
        valor AS valor_documento, valor_pago, data_vencimento, data_pagamento,
        status, numero_documento, forma_pagamento,
        CASE WHEN status IN ('recebido','pago') THEN 'pago'
             WHEN data_vencimento < v_hoje THEN 'vencido'
             WHEN data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM erp_receber
      WHERE company_id = p_company_id
        AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(status, '') != 'orcamento'
        AND (p_status_filtro = 'todos'
          OR (p_status_filtro = 'vencidos' AND data_vencimento < v_hoje AND status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'hoje' AND data_vencimento = v_hoje AND status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'avencer' AND data_vencimento > v_hoje AND status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'pagos' AND status IN ('recebido','pago')))
      ORDER BY data_vencimento ASC, descricao
      LIMIT 500
    ) a;
  END IF;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('data_inicio', p_data_inicio, 'data_fim', p_data_fim),
    'tipo', p_tipo,
    'kpis', jsonb_build_object(
      'vencidos', jsonb_build_object('valor', v_kpi_vencidos, 'qtd', v_cnt_vencidos),
      'hoje', jsonb_build_object('valor', v_kpi_hoje, 'qtd', v_cnt_hoje),
      'avencer', jsonb_build_object('valor', v_kpi_avencer, 'qtd', v_cnt_avencer),
      'pagos', jsonb_build_object('valor', v_kpi_pagos, 'qtd', v_cnt_pagos),
      'total', v_kpi_total
    ),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text) TO authenticated;

-- -------------------------------------------------------------
-- fn_fluxo_caixa_diario · mesmo padrao NULLIF
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(
  p_company_id uuid,
  p_data_inicio date DEFAULT ((CURRENT_DATE - INTERVAL '30 days'))::date,
  p_data_fim date DEFAULT ((CURRENT_DATE + INTERVAL '30 days'))::date,
  p_conta_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_inicial numeric;
  v_data_saldo_inicial date;
  v_resultado jsonb := '[]'::jsonb;
  v_saldo_acumulado numeric;
  v_dia record;
BEGIN
  SELECT
    COALESCE(SUM(saldo_inicial), 0),
    MIN(data_saldo_inicial)
  INTO v_saldo_inicial, v_data_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id
    AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true
    AND (p_conta_id IS NULL OR id = p_conta_id);

  v_saldo_acumulado := v_saldo_inicial;

  FOR v_dia IN
    SELECT
      d::date AS data,
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM erp_receber er
                WHERE er.company_id = p_company_id
                  AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM erp_pagar ep
                WHERE ep.company_id = p_company_id
                  AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'), 0) AS pagamentos,
      0::numeric AS transferencias_entrada,
      0::numeric AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado + v_dia.recebimentos - v_dia.pagamentos;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos,
      'saldo_final', v_saldo_acumulado
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('inicio', p_data_inicio, 'fim', p_data_fim),
    'saldo_inicial', v_saldo_inicial,
    'saldo_final', v_saldo_acumulado,
    'total_recebimentos', (SELECT SUM((d ->> 'recebimentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos', (SELECT SUM((d ->> 'pagamentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_ge_listagem_v2 IS
  'Listagem Pagar/Receber com intervalo de datas arbitrario. KPI pagos usa COALESCE(NULLIF(valor_pago,0), valor) pra lidar com lancamentos Omie quitados sem valor_pago. FIX-FINANCEIRO-VALORPAGO-v1.';

COMMENT ON FUNCTION public.fn_fluxo_caixa_diario IS
  'Fluxo de caixa diario. recebimentos/pagamentos usam COALESCE(NULLIF(valor_pago,0), valor, 0). FIX-FINANCEIRO-VALORPAGO-v1.';
