-- RD-41 · GE Financeiro — buscar por CPF/CNPJ em Pagar/Receber.
-- O documento mora no CADASTRO (erp_clientes/erp_fornecedores), não no título. A listagem
-- (fn_ge_listagem_v2) passa a devolver `documento` por linha via LEFT JOIN no cadastro
-- (fornecedor p/ pagar, cliente p/ receber) — a tela filtra por nome OU documento (normalizado).
-- ADITIVO (RD-26): só acrescenta a coluna `documento` no resultado; KPIs e demais campos idênticos.
-- Multi-tenant por company_id (inalterado). FRONTEIRA: financeiro de GE (serve todas as verticais).

CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date, p_status_filtro text DEFAULT 'todos'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb; v_hoje date := CURRENT_DATE;
  v_kpi_vencidos numeric; v_kpi_hoje numeric; v_kpi_avencer numeric; v_kpi_pagos numeric; v_kpi_total numeric;
  v_cnt_vencidos int; v_cnt_hoje int; v_cnt_avencer int; v_cnt_pagos int;
BEGIN
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
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
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.fornecedor_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(f.cpf_cnpj, f.cnpj_cpf) AS documento,
        CASE WHEN d.status = 'pago' THEN 'pago' WHEN d.data_vencimento < v_hoje THEN 'vencido' WHEN d.data_vencimento = v_hoje THEN 'hoje' ELSE 'a_vencer' END AS situacao
      FROM erp_pagar d
      LEFT JOIN erp_fornecedores f ON f.id = d.fornecedor_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL AND d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND (p_status_filtro = 'todos'
          OR (p_status_filtro = 'vencidos' AND d.data_vencimento < v_hoje AND d.status != 'pago')
          OR (p_status_filtro = 'hoje' AND d.data_vencimento = v_hoje AND d.status != 'pago')
          OR (p_status_filtro = 'avencer' AND d.data_vencimento > v_hoje AND d.status != 'pago')
          OR (p_status_filtro = 'pagos' AND d.status = 'pago'))
      ORDER BY d.data_vencimento ASC, d.descricao LIMIT 5000
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
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_receber
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim AND COALESCE(status, '') != 'orcamento';

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.cliente_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(c.cpf_cnpj, c.cnpj_cpf) AS documento,
        CASE WHEN d.status IN ('recebido','pago') THEN 'pago' WHEN d.data_vencimento < v_hoje THEN 'vencido' WHEN d.data_vencimento = v_hoje THEN 'hoje' ELSE 'a_vencer' END AS situacao
      FROM erp_receber d
      LEFT JOIN erp_clientes c ON c.id = d.cliente_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL AND d.data_vencimento BETWEEN p_data_inicio AND p_data_fim AND COALESCE(d.status, '') != 'orcamento'
        AND (p_status_filtro = 'todos'
          OR (p_status_filtro = 'vencidos' AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'hoje' AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'avencer' AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
          OR (p_status_filtro = 'pagos' AND d.status IN ('recebido','pago')))
      ORDER BY d.data_vencimento ASC, d.descricao LIMIT 5000
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
      'total', v_kpi_total),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END; $function$;
