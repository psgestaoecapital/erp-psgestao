-- Chamado #2734 (Canal PS · Rodrigo) — PRIORIDADE ALTA: a tela Financeiro → Despesas a pagar somava
-- lançamentos CANCELADOS no card VENCIDAS/VENCEM HOJE/A VENCER e no total. Correção de defeito (não é
-- feature nova — permitido em qualquer Fase do Saneamento V1).
--
-- CAUSA (RD-38, provado no dado da R.R d1330faf, erp_pagar, vencimento < hoje):
--   pago 644/R$1.057.692,39 · cancelado 16/R$168.612,00 · vencido 28/R$109.560,19 · aberto(venc.) 9/R$42.244,93
--   VENCIDAS mostrava 53/R$320.417,12 (contava os 16 CANCELADOS). Atraso REAL = 37/R$151.805,12 (bate com o OMIE).
-- O ramo 'pagar' da fn_ge_listagem_v2 excluía só ('pago','agendado','incluido_remessa') — NUNCA 'cancelado' —
-- e a lista não excluía cancelado em lugar nenhum (o front recompõe os cards a partir das linhas por `situacao`).
-- O ramo 'receber' JÁ exclui ('orcamento','renegociado','cancelado'); esta correção espelha isso no 'pagar',
-- adicionando `COALESCE(status,'') <> 'cancelado'` nos 3 blocos do ramo pagar (KPIs da janela, Bloco B all-time,
-- e a lista). 'pago' segue como antes (fora de vencidas; permanece no card Total, idêntico ao ramo receber).
-- NÃO altera nem apaga os registros cancelados — só para de somá-los. Vale para TODAS as empresas.
--
-- Migration de CORREÇÃO em função existente (financeiro de cliente) → via revisada (label revisao-eng-chefe).
-- Aceitação do comportamento: e2e @pos-migration (caminho-financeiro-pagar-cancelado.spec.ts).

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
  v_multi boolean := p_status_filtros IS NOT NULL AND cardinality(p_status_filtros) > 0;
BEGIN
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Datas invalidas: inicio=% fim=%', p_data_inicio, p_data_fim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF p_tipo = 'pagar' THEN
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
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      -- #2734 · cancelado nunca entra nos cards nem no total (espelha o ramo receber).
      AND COALESCE(status, '') <> 'cancelado';

    -- [Bloco B] vencido não tem período: recomputa vencidos all-time (sobrescreve o valor da janela).
    SELECT COALESCE(SUM(valor),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM erp_pagar
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('pago','agendado','incluido_remessa')
      AND COALESCE(status, '') <> 'cancelado';   -- #2734

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
        -- #2734 · cancelado não aparece na lista (nem soma no Total recomposto pelo front).
        AND COALESCE(d.status, '') <> 'cancelado'
        -- [Bloco B] período OU vencido-não-pago (vencido nunca some da lista)
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
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

    -- [Bloco B] vencido não tem período: recomputa vencidos all-time (sobrescreve o valor da janela).
    SELECT COALESCE(SUM(valor),0), COUNT(*)
      INTO v_kpi_vencidos, v_cnt_vencidos
    FROM v_receber_efetivo
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND data_vencimento < v_hoje AND status NOT IN ('recebido','pago')
      AND COALESCE(status, '') NOT IN ('orcamento','renegociado','cancelado');

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
        -- [Bloco B] período OU vencido-não-pago (vencido nunca some da lista)
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
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END; $function$;

-- Guarda (check-fn-guards, Regra 1): função SECURITY DEFINER não fica aberta ao anon.
-- Preserva o estado atual (anon nunca teve EXECUTE; só authenticated/service_role chamam esta listagem do GE Pró).
REVOKE ALL ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_listagem_v2(uuid, text, date, date, text, text[]) TO authenticated, service_role;
