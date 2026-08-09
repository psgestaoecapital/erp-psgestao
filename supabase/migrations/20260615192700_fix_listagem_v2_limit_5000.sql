-- =============================================================
-- fix_contas_filtro_todos_incluir_futuras_v1 · fn_ge_listagem_v2
-- =============================================================
-- Sintoma: filtro "Todos" em /financeiro/pagar (e /receber) nao
-- mostrava as parcelas A VENCER (vencimento futuro). KGF tinha
-- 902 contas mas a tela mostrava no maximo 500.
--
-- Causa: LIMIT 500 hardcoded na CTE de resultados. Como o ORDER BY eh
-- data_vencimento ASC, as parcelas A VENCER (mais distantes) ficavam
-- por ultimo e caiam no corte.
--
-- Fix: LIMIT 500 -> LIMIT 5000. Cobre folgado o caso atual (902 KGF).
--
-- Frontend complementar (mesmo PR): nova opcao "Todos os periodos"
-- no select de Periodo do ListagemPagarReceberView, que envia range
-- amplo 1900-01-01 ate 2999-12-31 pra RPC.
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date, p_status_filtro text DEFAULT 'todos'::text)
 RETURNS jsonb
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
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
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
      LIMIT 5000
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
      LIMIT 5000
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
