-- Despesas · exibição: status de remessa (agendado/incluido_remessa) tem PRECEDÊNCIA sobre o vencimento.
--
-- Bug (RD-41, teste da Jordana): o DISAUTO R$452,20 está com status='agendado' no banco, mas a tela de
-- Despesas mostra "Hoje" — porque fn_ge_listagem_v2 calculava `situacao` só pelo vencimento e ignorava o
-- status real quando é agendado/incluido_remessa. O dado está correto; era só a apresentação.
--
-- Fix (só o ramo 'pagar'; 'receber' fica idêntico):
--   1. situacao: pago > agendado > incluido_remessa > (vencido/hoje/a_vencer por data). Só 'aberto'/'parcial'/
--      'vencido' usam o derivado de vencimento.
--   2. KPIs de vencidos/hoje/a_vencer excluem os status de remessa (não contam um agendado como "Hoje").
--   3. Filtro (multi e single) ganha os buckets 'agendado' e 'incluido_remessa'; os buckets de vencimento
--      passam a exigir status NOT IN (pago,agendado,incluido_remessa) — assim um agendado não aparece em "Hoje".

CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(
  p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date,
  p_status_filtro text DEFAULT 'todos'::text, p_status_filtros text[] DEFAULT NULL::text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb; v_hoje date := CURRENT_DATE;
  v_kpi_vencidos numeric; v_kpi_hoje numeric; v_kpi_avencer numeric; v_kpi_pagos numeric; v_kpi_total numeric;
  v_cnt_vencidos int; v_cnt_hoje int; v_cnt_avencer int; v_cnt_pagos int;
  v_multi boolean := p_status_filtros IS NOT NULL AND cardinality(p_status_filtros) > 0;
BEGIN
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF p_tipo = 'pagar' THEN
    -- KPIs por vencimento EXCLUEM os status de remessa (agendado/incluido_remessa não contam como Hoje/Vencido)
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN valor ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE status = 'pago')
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.fornecedor_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(f.cpf_cnpj, f.cnpj_cpf) AS documento,
        -- PRECEDÊNCIA: status real da remessa vence o rótulo por vencimento
        CASE WHEN d.status = 'pago' THEN 'pago'
             WHEN d.status = 'agendado' THEN 'agendado'
             WHEN d.status = 'incluido_remessa' THEN 'incluido_remessa'
             WHEN d.data_vencimento < v_hoje THEN 'vencido'
             WHEN d.data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM erp_pagar d
      LEFT JOIN erp_fornecedores f ON f.id = d.fornecedor_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL AND d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos'         = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('hoje'             = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('avencer'          = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('pagos'            = ANY(p_status_filtros) AND d.status = 'pago')
              OR ('agendado'         = ANY(p_status_filtros) AND d.status = 'agendado')
              OR ('incluido_remessa' = ANY(p_status_filtros) AND d.status = 'incluido_remessa')
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos'         AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'hoje'             AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'avencer'          AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'pagos'            AND d.status = 'pago')
              OR (p_status_filtro = 'agendado'         AND d.status = 'agendado')
              OR (p_status_filtro = 'incluido_remessa' AND d.status = 'incluido_remessa')
          ) END
        )
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
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos' = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('hoje'     = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('avencer'  = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('pagos'    = ANY(p_status_filtros) AND d.status IN ('recebido','pago'))
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos' AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'hoje' AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'avencer' AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'pagos' AND d.status IN ('recebido','pago'))
          ) END
        )
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
