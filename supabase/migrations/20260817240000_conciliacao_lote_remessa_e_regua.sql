-- Conciliação PR B · débito da remessa sugere o lote + régua "Conciliado" na tela (RD-41)
--
-- Melhoria 2: quando o movimento do extrato é um débito de cobrança eletrônica de remessa
-- (DEB.COB.ELETR...-{NN} 0000{NN}), reconhece o padrão, extrai o número NN da remessa e devolve os
-- títulos PAGOS e ainda não conciliados daquele lote. O front casa o SUBCONJUNTO que soma ao valor do
-- débito (auditado: uma remessa gera MÚLTIPLOS débitos — ex.: KGF 54 = SICREDI 1485,41 + OUTROS 8712,76,
-- os 11 pagos somam 10198,17), aplica a guarda de valor e concilia agrupado em 1 clique (reusa
-- fn_conciliacao_fechar_agrupado, que não re-baixa título pago e carimba conciliado=true · #1037).
--
-- Régua: fn_ge_listagem_v2 passa a expor o derivado "Conciliado" (pago + conciliado=true) em pagar+receber.
-- ⚠️ Mexe em conciliação de títulos reais → reauditoria pós-merge (RD-53).

-- 1) Candidatos do lote da remessa para um movimento de débito (só leitura; o casamento/guarda é no front)
CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_remessa_candidatos(p_movimento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mov RECORD; v_nn int; v_rem RECORD; v_itens jsonb;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'movimento_nao_encontrado'); END IF;
  IF NOT (v_mov.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- reconhece "débito de cobrança eletrônica" (remessa) e extrai o número da remessa
  -- (o padrão termina em "...---54 000054" → o último grupo de dígitos é a remessa)
  IF COALESCE(v_mov.descricao,'') !~* 'COB\.?\s*ELETR' THEN
    RETURN jsonb_build_object('ok', true, 'aplicavel', false); END IF;
  v_nn := NULLIF((regexp_match(v_mov.descricao, '([0-9]+)\s*$'))[1], '')::int;
  IF v_nn IS NULL THEN RETURN jsonb_build_object('ok', true, 'aplicavel', false); END IF;

  -- remessa NN da empresa (não cancelada); se houver mais de uma, a mais recente gerada
  SELECT * INTO v_rem FROM erp_remessa_pagamento
   WHERE company_id = v_mov.company_id AND numero_sequencial = v_nn AND status <> 'cancelado'
   ORDER BY gerado_em DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'aplicavel', true, 'remessa', v_nn, 'encontrada', false,
      'valor_movimento', abs(v_mov.valor)); END IF;

  -- títulos PAGOS e ainda NÃO conciliados do lote (candidatos ao casamento do débito)
  SELECT jsonb_agg(jsonb_build_object(
           'lancamento_id', pg.id, 'lancamento_tabela', 'erp_pagar',
           'descricao', pg.descricao, 'fornecedor', pg.fornecedor_nome,
           'valor', round(pg.valor + COALESCE(pg.juros,0) - COALESCE(pg.desconto,0), 2),
           'vencimento', pg.data_vencimento) ORDER BY pg.data_vencimento, pg.descricao)
    INTO v_itens
    FROM erp_remessa_pagamento_item rpi
    JOIN erp_pagar pg ON pg.id = rpi.erp_pagar_id
   WHERE rpi.remessa_id = v_rem.id
     AND pg.status = 'pago' AND COALESCE(pg.conciliado, false) = false
     AND pg.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'aplicavel', true, 'remessa', v_nn, 'encontrada', true,
    'remessa_id', v_rem.id, 'valor_movimento', abs(v_mov.valor),
    'qtd', COALESCE(jsonb_array_length(v_itens), 0), 'itens', COALESCE(v_itens, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_lote_remessa_candidatos(uuid) TO authenticated;

-- 2) fn_ge_listagem_v2: régua "Conciliado" (pago + conciliado=true) em pagar+receber (display/filtro).
CREATE OR REPLACE FUNCTION public.fn_ge_listagem_v2(p_company_id uuid, p_tipo text, p_data_inicio date, p_data_fim date, p_status_filtro text DEFAULT 'todos'::text, p_status_filtros text[] DEFAULT NULL::text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim;

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
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL AND d.data_vencimento BETWEEN p_data_inicio AND p_data_fim
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
    FROM erp_receber
    WHERE company_id = p_company_id AND deleted_at IS NULL AND data_vencimento BETWEEN p_data_inicio AND p_data_fim AND COALESCE(status, '') != 'orcamento';

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
      FROM erp_receber d
      LEFT JOIN erp_clientes c ON c.id = d.cliente_id
      WHERE d.company_id = p_company_id AND d.deleted_at IS NULL AND d.data_vencimento BETWEEN p_data_inicio AND p_data_fim AND COALESCE(d.status, '') != 'orcamento'
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
