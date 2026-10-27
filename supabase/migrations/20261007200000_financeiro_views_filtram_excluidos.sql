-- 🔴 CEO 07/10 (Pdois/ProPlay): título EXCLUÍDO (deleted_at) aparecia como pendente em /dashboard/contas, aging e projeção.
-- Provado pelo Eng. Chefe: Pdois 64 pagar (R$ 130.242) + 95 receber (R$ 68.526) excluídos como pendentes; ProPlay 68 + 27.
-- Correção: as views passam a filtrar deleted_at IS NULL, mantendo security_invoker=true e as MESMAS colunas.
-- A projeção (v_psgc_fluxo_projecao) e o fluxo diário (fn_fluxo_caixa_diario) passam a respeitar a marcação
-- erp_banco_contas.incluir_no_fluxo=false (ex.: conta PERMUTA da Pdois) — recurso do núcleo, para qualquer empresa.
-- NÃO mexe em RLS/policies (a lixeira pode depender delas). Reversível: reaplicar as definições anteriores.

CREATE OR REPLACE VIEW public.v_lancamentos_consolidado WITH (security_invoker = true) AS
 SELECT p.id, p.company_id, 'pagar'::text AS tipo, NULL::uuid AS cliente_id, p.fornecedor_id, p.fornecedor_nome AS nome_pessoa,
    (p.data_emissao)::text AS data_emissao, (p.data_vencimento)::text AS data_vencimento, (p.data_previsao)::text AS data_previsao,
    (p.data_pagamento)::text AS data_pagamento, p.valor AS valor_documento, p.valor_pago, p.status, p.categoria,
    NULL::text AS subcategoria, p.centro_custo, p.numero_documento, p.descricao, p.recorrente, NULL::text AS frequencia,
    NULL::integer AS parcela_atual, NULL::integer AS total_parcelas, NULL::uuid AS created_by, p.created_at, p.updated_at,
    p.forma_pagamento, NULL::uuid AS conta_bancaria_id, p.juros, p.multa, p.desconto, NULL::text AS anexo_url,
    p.observacoes AS observacao_interna, NULL::text[] AS tags, NULL::uuid AS recorrente_origem_id, NULL::integer AS intervalo_dias,
    NULL::text AS moeda, NULL::numeric AS valor_moeda_origem, NULL::numeric AS taxa_cambio, NULL::uuid AS hierarchy_id,
    NULL::uuid AS centro_custo_id, NULL::uuid AS business_line_id, NULL::text AS plano_conta_codigo, NULL::uuid AS banco_conta_id,
    p.import_hash
   FROM erp_pagar p
  WHERE p.deleted_at IS NULL
UNION ALL
 SELECT r.id, r.company_id, 'receber'::text AS tipo, r.cliente_id, NULL::uuid AS fornecedor_id, r.cliente_nome AS nome_pessoa,
    (r.data_emissao)::text AS data_emissao, (r.data_vencimento)::text AS data_vencimento, (r.data_previsao)::text AS data_previsao,
    (r.data_pagamento)::text AS data_pagamento, r.valor AS valor_documento, r.valor_pago, r.status, r.categoria,
    NULL::text AS subcategoria, r.centro_custo, r.numero_documento, r.descricao, r.recorrente, NULL::text AS frequencia,
    NULL::integer AS parcela_atual, NULL::integer AS total_parcelas, NULL::uuid AS created_by, r.created_at, r.updated_at,
    r.forma_pagamento, NULL::uuid AS conta_bancaria_id, r.juros, r.multa, r.desconto, NULL::text AS anexo_url,
    r.observacoes AS observacao_interna, NULL::text[] AS tags, NULL::uuid AS recorrente_origem_id, NULL::integer AS intervalo_dias,
    NULL::text AS moeda, NULL::numeric AS valor_moeda_origem, NULL::numeric AS taxa_cambio, NULL::uuid AS hierarchy_id,
    NULL::uuid AS centro_custo_id, NULL::uuid AS business_line_id, NULL::text AS plano_conta_codigo, NULL::uuid AS banco_conta_id,
    r.import_hash
   FROM erp_receber r
  WHERE r.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_contas_pagar_aging WITH (security_invoker = true) AS
 SELECT p.id, p.company_id, c.nome_fantasia AS empresa, p.fornecedor_nome AS fornecedor, p.fornecedor_id, p.descricao, p.valor,
    p.data_emissao, p.data_vencimento, p.status, (CURRENT_DATE - p.data_vencimento) AS dias_atraso,
        CASE
            WHEN ((p.status)::text = 'pago'::text) THEN 'pago'::text
            WHEN ((p.status)::text = 'cancelado'::text) THEN 'cancelado'::text
            WHEN (p.data_vencimento >= CURRENT_DATE) THEN 'em_dia'::text
            WHEN (((CURRENT_DATE - p.data_vencimento) >= 1) AND ((CURRENT_DATE - p.data_vencimento) <= 15)) THEN 'atraso_1_15'::text
            WHEN (((CURRENT_DATE - p.data_vencimento) >= 16) AND ((CURRENT_DATE - p.data_vencimento) <= 30)) THEN 'atraso_16_30'::text
            WHEN (((CURRENT_DATE - p.data_vencimento) >= 31) AND ((CURRENT_DATE - p.data_vencimento) <= 60)) THEN 'atraso_31_60'::text
            WHEN (((CURRENT_DATE - p.data_vencimento) >= 61) AND ((CURRENT_DATE - p.data_vencimento) <= 90)) THEN 'atraso_61_90'::text
            WHEN ((CURRENT_DATE - p.data_vencimento) > 90) THEN 'atraso_mais_90'::text
            ELSE 'indefinido'::text
        END AS faixa_aging
   FROM (erp_pagar p LEFT JOIN companies c ON ((c.id = p.company_id)))
  WHERE ((p.status)::text <> 'cancelado'::text) AND p.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_contas_receber_aging WITH (security_invoker = true) AS
 SELECT r.id, r.company_id, c.nome_fantasia AS empresa, r.cliente_nome AS cliente, r.cliente_id, r.descricao, r.valor,
    r.data_emissao, r.data_vencimento, r.status, (CURRENT_DATE - r.data_vencimento) AS dias_atraso,
        CASE
            WHEN ((r.status)::text = 'pago'::text) THEN 'pago'::text
            WHEN ((r.status)::text = 'cancelado'::text) THEN 'cancelado'::text
            WHEN (r.data_vencimento >= CURRENT_DATE) THEN 'em_dia'::text
            WHEN (((CURRENT_DATE - r.data_vencimento) >= 1) AND ((CURRENT_DATE - r.data_vencimento) <= 15)) THEN 'atraso_1_15'::text
            WHEN (((CURRENT_DATE - r.data_vencimento) >= 16) AND ((CURRENT_DATE - r.data_vencimento) <= 30)) THEN 'atraso_16_30'::text
            WHEN (((CURRENT_DATE - r.data_vencimento) >= 31) AND ((CURRENT_DATE - r.data_vencimento) <= 60)) THEN 'atraso_31_60'::text
            WHEN (((CURRENT_DATE - r.data_vencimento) >= 61) AND ((CURRENT_DATE - r.data_vencimento) <= 90)) THEN 'atraso_61_90'::text
            WHEN ((CURRENT_DATE - r.data_vencimento) > 90) THEN 'atraso_mais_90'::text
            ELSE 'indefinido'::text
        END AS faixa_aging
   FROM (erp_receber r LEFT JOIN companies c ON ((c.id = r.company_id)))
  WHERE ((r.status)::text <> 'cancelado'::text) AND r.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_psgc_fluxo_projecao WITH (security_invoker = true) AS
 WITH realizado AS (
         SELECT psgc_fluxo_realizado.company_id, psgc_fluxo_realizado.data, psgc_fluxo_realizado.entradas,
            psgc_fluxo_realizado.saidas, psgc_fluxo_realizado.saldo_dia, 'realizado'::text AS tipo
           FROM psgc_fluxo_realizado
          WHERE ((psgc_fluxo_realizado.data >= (CURRENT_DATE - '90 days'::interval)) AND (psgc_fluxo_realizado.data <= CURRENT_DATE))
        ), projecao AS (
         SELECT sub.company_id, sub.dv AS data,
            (COALESCE(sum(CASE WHEN (sub.tipo_mov = 'entrada'::text) THEN sub.v ELSE NULL::numeric END), (0)::numeric))::numeric(15,2) AS entradas,
            (COALESCE(sum(CASE WHEN (sub.tipo_mov = 'saida'::text) THEN sub.v ELSE NULL::numeric END), (0)::numeric))::numeric(15,2) AS saidas,
            (COALESCE(sum(CASE WHEN (sub.tipo_mov = 'entrada'::text) THEN sub.v ELSE (- sub.v) END), (0)::numeric))::numeric(15,2) AS saldo_dia,
            'projetado'::text AS tipo
           FROM ( SELECT r.company_id, r.data_vencimento AS dv, 'entrada'::text AS tipo_mov, r.valor AS v
                   FROM erp_receber r
                  WHERE r.deleted_at IS NULL
                    AND ((r.data_vencimento >= CURRENT_DATE) AND (r.data_vencimento <= (CURRENT_DATE + '60 days'::interval)))
                    AND ((r.status IS NULL) OR ((r.status)::text <> ALL ((ARRAY['pago'::character varying, 'cancelado'::character varying])::text[])))
                    AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = r.conta_bancaria_id AND b.incluir_no_fluxo = false)
                UNION ALL
                 SELECT p.company_id, p.data_vencimento, 'saida'::text AS tipo_mov, p.valor
                   FROM erp_pagar p
                  WHERE p.deleted_at IS NULL
                    AND ((p.data_vencimento >= CURRENT_DATE) AND (p.data_vencimento <= (CURRENT_DATE + '60 days'::interval)))
                    AND ((p.status IS NULL) OR ((p.status)::text <> ALL ((ARRAY['pago'::character varying, 'cancelado'::character varying])::text[])))
                    AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = p.company_id AND b.incluir_no_fluxo = false
                                      AND lower(b.nome) = lower(p.conta_bancaria))) sub
          GROUP BY sub.company_id, sub.dv
        )
 SELECT realizado.company_id, realizado.data, realizado.entradas, realizado.saidas, realizado.saldo_dia, realizado.tipo FROM realizado
UNION ALL
 SELECT projecao.company_id, projecao.data, projecao.entradas, projecao.saidas, projecao.saldo_dia, projecao.tipo FROM projecao
  ORDER BY 1, 2;

-- Fluxo diário: conta marcada incluir_no_fluxo=false fora do consolidado (com conta específica escolhida segue como antes).
CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(p_company_id uuid, p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
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
  SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
    INTO v_saldo_inicial, v_data_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true
    AND (p_conta_id IS NULL OR id = p_conta_id);

  v_saldo_acumulado := v_saldo_inicial;

  FOR v_dia IN
    SELECT
      d::date AS data,
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')
                  AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'
                  AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))), 0) AS pagamentos,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado + v_dia.recebimentos - v_dia.pagamentos
                         + v_dia.transferencias_entrada - v_dia.transferencias_saida;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos
                       + v_dia.transferencias_entrada - v_dia.transferencias_saida,
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
    'total_transferencias_entrada', (SELECT SUM((d ->> 'transferencias_entrada')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_saida', (SELECT SUM((d ->> 'transferencias_saida')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;
