-- PDCA GE · /dashboard/financeiro/fluxo-caixa · fn_fluxo_caixa_diario: REALIZADO pelo LEDGER de baixa
-- Code: code-desenvolvedor-3 · auditor_pdca_2 16/11 (RD-38) · NÚCLEO FINANCEIRO (dinheiro de cliente)
--
-- BUG (provado no dado, RD-38): o REALIZADO (recebimentos/pagamentos efetivos) era calculado chaveando por
-- erp_receber.data_pagamento / erp_pagar.data_pagamento. Mas o registro AUTORITATIVO de QUANDO o dinheiro
-- entrou/saiu é o LEDGER de baixa (erp_receber_baixa / erp_pagar_baixa), que suporta baixa PARCIAL em várias
-- datas (um título com 3 baixas tem 3 datas; data_pagamento guarda no máximo uma). Quando a baixa não carimba
-- data_pagamento no título (massa/bulk, baixa parcial multi-data), o REALIZADO zerava.
--
-- PROVA na Demonstração Comércio GE (b07...004), período 01/10–16/11 (fn_fluxo_caixa_diario):
--   ANTES:  total_recebimentos = R$0,00        · total_pagamentos = R$193,81
--   DEPOIS: total_recebimentos ≈ R$4,53 milhões · total_pagamentos ≈ R$4,42 milhões  (= SUM do ledger de baixas)
--   (52.732 baixas de recebimento e 15.015 de pagamento, datadas, no período.)
--
-- CORREÇÃO (aditiva no comportamento — só muda a FONTE do realizado; mantém guarda de empresa, conta, categoria,
-- incluir_no_fluxo, transferências, saldo e shape do retorno):
--   1) REALIZADO ENTRADA  = SUM(erp_receber_baixa.valor) por erp_receber_baixa.data = dia (b.deleted_at IS NULL),
--      com JOIN em erp_receber só para os filtros de conta/categoria/incluir_no_fluxo.
--   2) REALIZADO SAÍDA    = idem com erp_pagar_baixa.
--   3) PREVISTO e VENCIDO passam a somar o SALDO DEVEDOR do título aberto, GREATEST(valor - valor_pago, 0), para
--      NÃO contar em dobro com o realizado: a parte já recebida/paga entra pelo ledger (realizado); o previsto é
--      só o que FALTA. (Em GE demo: 0 títulos parciais com vencimento futuro, então o previsto não muda; a regra
--      protege os tenants reais com baixa parcial.)
--   b.deleted_at IS NULL é o sinal autoritativo de "a baixa é viva (não estornada)"; baixa estornada já é
--   soft-deletada no ledger, então não entra no realizado.
-- Nunca altera/apaga dado de cliente (só CREATE INDEX aditivo + CREATE OR REPLACE da RPC de leitura).

-- Índices: a RPC varre o ledger por (company_id, data) um dia de cada vez; sem este índice cada dia varria todas
-- as baixas da empresa. Parcial (deleted_at IS NULL) — o realizado só olha baixa viva.
CREATE INDEX IF NOT EXISTS idx_erp_receber_baixa_company_data
  ON public.erp_receber_baixa (company_id, data) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_erp_pagar_baixa_company_data
  ON public.erp_pagar_baixa (company_id, data) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(p_company_id uuid, p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date, p_conta_id uuid DEFAULT NULL::uuid, p_categoria text DEFAULT NULL::text)
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
  v_hoje date := CURRENT_DATE;
  v_primeiro_futuro date := GREATEST(CURRENT_DATE + 1, p_data_inicio);
  v_receber_vencido numeric;
  v_pagar_vencido numeric;
  v_conta_nome text;            -- nome da conta escolhida (erp_pagar liga por nome, não por id)
  v_categoria text := NULLIF(btrim(p_categoria), '');  -- '' = sem filtro
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- nome da conta escolhida (uma vez; erp_pagar.conta_bancaria é texto)
  IF p_conta_id IS NOT NULL THEN
    SELECT nome INTO v_conta_nome FROM erp_banco_contas WHERE id = p_conta_id AND company_id = p_company_id;
  END IF;

  -- Saldo inicial: só faz sentido na vista por conta/empresa. Na vista por CATEGORIA o acumulado começa em 0.
  IF v_categoria IS NULL THEN
    SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
      INTO v_saldo_inicial, v_data_saldo_inicial
    FROM erp_banco_contas
    WHERE company_id = p_company_id AND ativo = true
      AND COALESCE(soma_no_saldo, true) = true
      AND (p_conta_id IS NULL OR id = p_conta_id);
  ELSE
    v_saldo_inicial := 0;
    v_data_saldo_inicial := NULL;
  END IF;

  v_saldo_acumulado := v_saldo_inicial;

  -- Vencidos em aberto (venc < hoje): saldo DEVEDOR (valor - já pago). O já pago entra no REALIZADO pelo ledger.
  SELECT COALESCE(SUM(GREATEST(COALESCE(er.valor,0) - COALESCE(er.valor_pago,0), 0)), 0)
    INTO v_receber_vencido
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id AND er.data_vencimento < v_hoje
    AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
    AND (v_categoria IS NULL OR er.categoria = v_categoria);

  SELECT COALESCE(SUM(GREATEST(COALESCE(ep.valor,0) - COALESCE(ep.valor_pago,0), 0)), 0)
    INTO v_pagar_vencido
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
  WHERE ep.company_id = p_company_id AND ep.data_vencimento < v_hoje
    AND ep.status NOT IN ('pago', 'cancelado')
    AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
    AND (v_categoria IS NULL OR ep.categoria = v_categoria);

  FOR v_dia IN
    SELECT
      d::date AS data,
      (d::date > v_hoje) AS eh_futuro,
      -- REALIZADO ENTRADA: ledger de baixas (erp_receber_baixa) pela data real do recebimento
      COALESCE((SELECT SUM(b.valor)
                FROM public.erp_receber_baixa b
                JOIN public.erp_receber er ON er.id = b.receber_id
                WHERE b.company_id = p_company_id AND b.deleted_at IS NULL AND b.data = d::date
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas bc WHERE bc.id = er.conta_bancaria_id AND bc.incluir_no_fluxo = false) END)
                  AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0) AS recebimentos,
      -- REALIZADO SAÍDA: ledger de baixas (erp_pagar_baixa) pela data real do pagamento
      COALESCE((SELECT SUM(b.valor)
                FROM public.erp_pagar_baixa b
                JOIN public.erp_pagar ep ON ep.id = b.pagar_id
                WHERE b.company_id = p_company_id AND b.deleted_at IS NULL AND b.data = d::date
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas bc WHERE bc.company_id = ep.company_id AND bc.incluir_no_fluxo = false AND lower(bc.nome) = lower(ep.conta_bancaria)) END)
                  AND (v_categoria IS NULL OR ep.categoria = v_categoria)), 0) AS pagamentos,
      -- PREVISTO ENTRADA (futuro, por vencimento): saldo DEVEDOR do título aberto (valor - já pago)
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(GREATEST(COALESCE(er.valor,0) - COALESCE(er.valor_pago,0), 0))
                  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                  WHERE er.company_id = p_company_id AND er.data_vencimento = d::date
                    AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
                    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
                    AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(GREATEST(COALESCE(ep.valor,0) - COALESCE(ep.valor_pago,0), 0))
                  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                  WHERE ep.company_id = p_company_id AND ep.data_vencimento = d::date
                    AND ep.status NOT IN ('pago', 'cancelado')
                    AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
                    AND (v_categoria IS NULL OR ep.categoria = v_categoria)), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_pagar_vencido ELSE 0 END
      ELSE 0 END AS pagamentos_previstos,
      -- Transferências não têm categoria: na vista por categoria ficam zeradas.
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND v_categoria IS NULL AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND v_categoria IS NULL AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado
                         + v_dia.recebimentos - v_dia.pagamentos
                         + v_dia.recebimentos_previstos - v_dia.pagamentos_previstos
                         + v_dia.transferencias_entrada - v_dia.transferencias_saida;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'eh_futuro', v_dia.eh_futuro,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'recebimentos_previstos', v_dia.recebimentos_previstos,
      'pagamentos_previstos', v_dia.pagamentos_previstos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos
                       + v_dia.recebimentos_previstos - v_dia.pagamentos_previstos
                       + v_dia.transferencias_entrada - v_dia.transferencias_saida,
      'saldo_final', v_saldo_acumulado
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('inicio', p_data_inicio, 'fim', p_data_fim),
    'hoje', v_hoje,
    'conta_id', p_conta_id,
    'categoria', v_categoria,
    'saldo_inicial', v_saldo_inicial,
    'saldo_final', v_saldo_acumulado,
    'total_recebimentos', (SELECT COALESCE(SUM((d ->> 'recebimentos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos', (SELECT COALESCE(SUM((d ->> 'pagamentos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_recebimentos_previstos', (SELECT COALESCE(SUM((d ->> 'recebimentos_previstos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos_previstos', (SELECT COALESCE(SUM((d ->> 'pagamentos_previstos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_receber_vencido_aberto', v_receber_vencido,
    'total_pagar_vencido_aberto', v_pagar_vencido,
    'total_transferencias_entrada', (SELECT COALESCE(SUM((d ->> 'transferencias_entrada')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_saida', (SELECT COALESCE(SUM((d ->> 'transferencias_saida')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;

-- ACL explícita (idêntica à ACL viva: authenticated/service_role, sem anon/PUBLIC) — exigida pelo gate check_fn_guards.
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) TO authenticated, service_role;
