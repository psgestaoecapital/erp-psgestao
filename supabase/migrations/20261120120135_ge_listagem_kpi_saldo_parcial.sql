-- PDCA GE · /dashboard/financeiro/receber (e pagar, simétrico) · aud8 88/95
-- GAP (dinheiro): os KPIs de topo "Vencidos/Hoje/A vencer" e o card "Total" somavam valor BRUTO
-- (SUM(valor)) e ignoravam valor_pago em títulos 'parcial', superavaliando o que há a receber/pagar.
-- A LISTA já mostra valor_documento + valor_pago (saldo correto por linha); o topo não batia.
--
-- PROVA (RD-38 · DEMO Comércio GE b0700000-0000-4000-a000-000000000004 · 01-30/11/2026 · hoje 17/11):
--   ANTES: kpis.vencidos.valor = 21027.26 ; kpis.total = 23086.51
--   SALDO: SUM(valor - COALESCE(valor_pago,0)) vencidos = 20556.51 ; total da lista = 22615.76
--   Diferença 470.75 = valor_pago dos 2 títulos 'parcial' vencidos (464.00 + 6.75), conferido linha a linha.
--
-- CORREÇÃO (aditiva, CREATE OR REPLACE): nas somas de KPI de ABERTO (vencidos/hoje/avencer) e na
-- recomposição de v_kpi_total, trocar SUM(valor) por SUM(valor - COALESCE(valor_pago,0)) nos DOIS ramos
-- (pagar e receber). O ramo 'pagos'/'recebidos' MANTÉM COALESCE(NULLIF(valor_pago,0),valor).
-- Preserva: exclusão de 'renegociado'/'orcamento'/'cancelado' (de-dup) e o fix v_kpi_total >= vencidos (09/11).

CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date, p_status_filtro text DEFAULT 'todos'::text, p_status_filtros text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultados jsonb; v_hoje date := CURRENT_DATE;
  v_kpi_vencidos numeric; v_kpi_hoje numeric; v_kpi_avencer numeric; v_kpi_pagos numeric; v_kpi_total numeric;
  v_cnt_vencidos int; v_cnt_hoje int; v_cnt_avencer int; v_cnt_pagos int;
  v_total_rows int := 0;   -- total de linhas da LISTA (pré-LIMIT 5000), p/ o card Total e o aviso de truncagem
  v_multi boolean := p_status_filtros IS NOT NULL AND cardinality(p_status_filtros) > 0;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')),
      COUNT(*) FILTER (WHERE status = 'pago')
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      AND COALESCE(status, '') <> 'cancelado';

    SELECT COALESCE(SUM(valor - COALESCE(valor_pago, 0)),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')
      AND COALESCE(status, '') <> 'cancelado';

    -- total de linhas da LISTA (mesmo conjunto do jsonb_agg abaixo, sem o LIMIT e sem o filtro de chips).
    -- GAP núcleo (auditor_pdca_2 09/11): o 1º SELECT calcula v_kpi_total só na JANELA do período, mas
    -- o bloco acima SOBRESCREVE v_kpi_vencidos com o all-time; v_kpi_total ficava MENOR que vencidos.
    -- Recompomos v_kpi_total sobre o MESMO conjunto da lista (período OU vencido-aberto all-time), para o
    -- card "Total" bater com a soma das linhas exibidas e ser sempre >= vencidos. Aditivo, sem regressão.
    -- SALDO (16/11): soma valor - valor_pago, para o Total não contar o que já foi pago em títulos parciais.
    SELECT COUNT(*), COALESCE(SUM(d.valor - COALESCE(d.valor_pago, 0)),0) INTO v_total_rows, v_kpi_total
    FROM erp_pagar d
    WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
      AND COALESCE(d.status, '') <> 'cancelado'
      AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
           OR (d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa')));

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.fornecedor_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.conciliado, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(f.cpf_cnpj, f.cnpj_cpf) AS documento,
        CASE WHEN d.status = 'pago' AND d.conciliado THEN 'conciliado'
             WHEN d.status = 'pago' THEN 'pago'
             WHEN d.status = 'agendado' THEN 'agendado'
             WHEN d.status = 'incluido_remessa' THEN 'incluido_remessa'
             WHEN d.data_vencimento < v_hoje THEN 'vencido'
             WHEN d.data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM erp_pagar d
      LEFT JOIN erp_fornecedores f ON f.id = d.fornecedor_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
        AND COALESCE(d.status, '') <> 'cancelado'
        AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
             OR (d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa')))
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos'         = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('hoje'             = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('avencer'          = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR ('pagos'            = ANY(p_status_filtros) AND d.status = 'pago' AND NOT COALESCE(d.conciliado,false))
              OR ('conciliado'       = ANY(p_status_filtros) AND d.status = 'pago' AND COALESCE(d.conciliado,false))
              OR ('agendado'         = ANY(p_status_filtros) AND d.status = 'agendado')
              OR ('incluido_remessa' = ANY(p_status_filtros) AND d.status = 'incluido_remessa')
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos'         AND d.data_vencimento < v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'hoje'             AND d.data_vencimento = v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'avencer'          AND d.data_vencimento > v_hoje AND d.status NOT IN ('pago','agendado','incluido_remessa'))
              OR (p_status_filtro = 'pagos'            AND d.status = 'pago' AND NOT COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'conciliado'       AND d.status = 'pago' AND COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'agendado'         AND d.status = 'agendado')
              OR (p_status_filtro = 'incluido_remessa' AND d.status = 'incluido_remessa')
          ) END
        )
      ORDER BY d.data_vencimento ASC, d.descricao LIMIT 5000
    ) a;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN data_vencimento < v_hoje AND status NOT IN ('recebido','pago') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento = v_hoje AND status NOT IN ('recebido','pago') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN data_vencimento > v_hoje AND status NOT IN ('recebido','pago') THEN (valor - COALESCE(valor_pago, 0)) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status IN ('recebido','pago') THEN COALESCE(NULLIF(valor_pago, 0), valor) ELSE 0 END), 0),
      COALESCE(SUM(valor), 0),
      COUNT(*) FILTER (WHERE data_vencimento < v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento = v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE data_vencimento > v_hoje AND status NOT IN ('recebido','pago')),
      COUNT(*) FILTER (WHERE status IN ('recebido','pago'))
    INTO v_kpi_vencidos, v_kpi_hoje, v_kpi_avencer, v_kpi_pagos, v_kpi_total, v_cnt_vencidos, v_cnt_hoje, v_cnt_avencer, v_cnt_pagos
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

    SELECT COALESCE(SUM(valor - COALESCE(valor_pago, 0)),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('recebido','pago')
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

    -- Mesmo GAP núcleo do ramo pagar: recompõe v_kpi_total sobre o conjunto da LISTA (período OU
    -- vencido-aberto all-time), para o card "Total" bater com as linhas exibidas e ser >= vencidos.
    -- SALDO (16/11): soma valor - valor_pago, para o Total não contar o que já foi recebido em parciais.
    SELECT COUNT(*), COALESCE(SUM(d.valor - COALESCE(d.valor_pago, 0)),0) INTO v_total_rows, v_kpi_total
    FROM v_receber_efetivo d
    WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
      AND COALESCE(d.status, '') NOT IN ('orcamento','renegociado','cancelado')
      AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
           OR (d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago')));

    SELECT jsonb_agg(row_to_json(a)) INTO v_resultados
    FROM (
      SELECT d.id, d.descricao, d.cliente_nome AS nome_pessoa, d.categoria, d.valor AS valor_documento, d.valor_pago,
        d.data_vencimento, d.data_pagamento, d.status, d.conciliado, d.numero_documento, d.forma_pagamento, d.observacoes,
        COALESCE(c.cpf_cnpj, c.cnpj_cpf) AS documento,
        CASE WHEN d.status IN ('recebido','pago') AND d.conciliado THEN 'conciliado'
             WHEN d.status IN ('recebido','pago') THEN 'pago'
             WHEN d.data_vencimento < v_hoje THEN 'vencido'
             WHEN d.data_vencimento = v_hoje THEN 'hoje'
             ELSE 'a_vencer' END AS situacao
      FROM v_receber_efetivo d
      LEFT JOIN erp_clientes c ON c.id = d.cliente_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL
        AND (d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
             OR (d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago')))
        AND COALESCE(d.status, '') NOT IN ('orcamento','renegociado','cancelado')
        AND (
          CASE WHEN v_multi THEN (
                 'todos' = ANY(p_status_filtros)
              OR ('vencidos'   = ANY(p_status_filtros) AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('hoje'       = ANY(p_status_filtros) AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('avencer'    = ANY(p_status_filtros) AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR ('pagos'      = ANY(p_status_filtros) AND d.status IN ('recebido','pago') AND NOT COALESCE(d.conciliado,false))
              OR ('conciliado' = ANY(p_status_filtros) AND d.status IN ('recebido','pago') AND COALESCE(d.conciliado,false))
          )
          ELSE (
                 p_status_filtro = 'todos'
              OR (p_status_filtro = 'vencidos'   AND d.data_vencimento < v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'hoje'       AND d.data_vencimento = v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'avencer'    AND d.data_vencimento > v_hoje AND d.status NOT IN ('recebido','pago'))
              OR (p_status_filtro = 'pagos'      AND d.status IN ('recebido','pago') AND NOT COALESCE(d.conciliado,false))
              OR (p_status_filtro = 'conciliado' AND d.status IN ('recebido','pago') AND COALESCE(d.conciliado,false))
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
    'total_rows', v_total_rows,
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END; $function$;

-- ACL explícita (check_fn_guards): reproduz a ACL viva (authenticated/service_role, sem anon/PUBLIC); não muda permissão.
REVOKE ALL ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) TO authenticated, service_role;
