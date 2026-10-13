-- =============================================================
-- fn_ge_listagem_v2 · aceita intervalo arbitrario de datas
-- Saneamento V1 Fase 3 · Foundational fix listagem Pagar/Receber
-- Contexto: erp_contexto_projeto 0f2c0346-3a04-43e4-a37a-8fdc8ccb6973
-- Aplicado via MCP apply_migration · rastreio historico no repo.
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
      COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(valor_pago, valor) ELSE 0 END), 0),
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
      COALESCE(SUM(CASE WHEN status IN ('recebido','pago') THEN COALESCE(valor_pago, valor) ELSE 0 END), 0),
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

COMMENT ON FUNCTION public.fn_ge_listagem_v2 IS
  'Listagem Pagar/Receber com intervalo de datas arbitrario. Substitui fn_ge_listagem que aceitava apenas (ano, mes). Saneamento V1 Fase 3.';
