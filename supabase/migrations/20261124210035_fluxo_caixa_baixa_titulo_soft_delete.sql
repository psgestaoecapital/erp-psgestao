-- fix(ge · /dashboard/financeiro/fluxo-caixa): baixa de titulo soft-deletado nao conta no caixa realizado
--
-- BUG DE CORRETUDE (producao). Nas CTEs do REALIZADO de fn_fluxo_caixa_diario o JOIN baixa->titulo
-- filtrava apenas o status do pai (cancelado/renegociado, gap 18/11) mas NAO o soft-delete:
--   rec_real: ... JOIN erp_receber er ... AND er.status NOT IN ('cancelado','renegociado')  -- faltava er.deleted_at IS NULL
--   pag_real: ... JOIN erp_pagar ep ... AND ep.status <> 'cancelado'                         -- faltava ep.deleted_at IS NULL
-- Consequencia: excluir (soft-delete) um titulo que tinha baixa deixava a baixa contando como
-- caixa realizado (recebimento/pagamento fantasma), inflando o saldo do fluxo. As CTEs de PREVISTO
-- (rec_prev/pag_prev) e a vista de VENCIDO ja filtram deleted_at do pai; so o REALIZADO escapava.
--
-- RD-38 (prova no dado 23/11): empresas REAIS afetadas hoje (lado pagar b26c19c0 R$8.818,08,
-- d577602d R$3.132,59; lado receber a462e13f R$410) e a DEMO GE (b0700000-...-004) exibia
-- ~R$2,25 mi de recebimento e ~R$3,85 mi de pagamento fantasma na janela padrao. Sweep das irmas
-- que leem *_baixa (RD-38): fn_caixa_grupo_dia, fn_caixa_grupo_titulos, fn_saldo_gerencial_contas,
-- fn_relatorio_movimentacao_linhas, fn_conciliacao_sugerir_match_lote e fn_obras_receita ja filtram
-- o deleted_at do pai -- esta e a unica regressao. Correcao cirurgica: +1 linha por CTE realizada.
--
-- Idempotente (CREATE OR REPLACE). Aditiva: nao altera dado de cliente, nenhuma estrutura, nenhuma policy.

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

  -- Laço set-based: cada ledger/origem é agregado UMA vez por dia (GROUP BY), e unido à
  -- série de dias. O laço só acumula o saldo e monta o jsonb sobre ~60 linhas já prontas.
  FOR v_dia IN
    WITH dias AS (
      SELECT d::date AS data
      FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
    ),
    -- REALIZADO ENTRADA: ledger de baixas (erp_receber_baixa) pela data real do recebimento
    rec_real AS (
      SELECT b.data, SUM(b.valor) AS v
      FROM public.erp_receber_baixa b
      JOIN public.erp_receber er ON er.id = b.receber_id
      WHERE b.company_id = p_company_id AND b.deleted_at IS NULL
        AND b.data BETWEEN p_data_inicio AND p_data_fim
        -- CORRECTNESS (gap 18/11): cancelar/renegociar um título NÃO estorna a baixa do ledger
        -- (fn_receber_cancelar não mexe em erp_receber_baixa). Sem este filtro, a baixa de um
        -- título cancelado seguia contando como caixa realizado (fantasma) e inflava o saldo.
        AND er.status NOT IN ('cancelado', 'renegociado')
        -- CORRECTNESS (gap 23/11): soft-delete do título também não estorna a baixa do ledger.
        -- Sem este filtro, excluir um título com baixa deixava a baixa contando como caixa realizado.
        AND er.deleted_at IS NULL
        AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas bc WHERE bc.id = er.conta_bancaria_id AND bc.incluir_no_fluxo = false) END)
        AND (v_categoria IS NULL OR er.categoria = v_categoria)
      GROUP BY b.data
    ),
    -- REALIZADO SAÍDA: ledger de baixas (erp_pagar_baixa) pela data real do pagamento
    pag_real AS (
      SELECT b.data, SUM(b.valor) AS v
      FROM public.erp_pagar_baixa b
      JOIN public.erp_pagar ep ON ep.id = b.pagar_id
      WHERE b.company_id = p_company_id AND b.deleted_at IS NULL
        AND b.data BETWEEN p_data_inicio AND p_data_fim
        -- CORRECTNESS (gap 18/11): simétrico ao recebimento — baixa de título pago e depois
        -- cancelado não deve seguir contando como saída realizada.
        AND ep.status <> 'cancelado'
        -- CORRECTNESS (gap 23/11): simétrico — baixa de título pago e depois soft-deletado
        -- não deve seguir contando como saída realizada.
        AND ep.deleted_at IS NULL
        AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas bc WHERE bc.company_id = ep.company_id AND bc.incluir_no_fluxo = false AND lower(bc.nome) = lower(ep.conta_bancaria)) END)
        AND (v_categoria IS NULL OR ep.categoria = v_categoria)
      GROUP BY b.data
    ),
    -- PREVISTO ENTRADA (futuro, por vencimento): saldo DEVEDOR do título aberto (valor - já pago)
    rec_prev AS (
      SELECT er.data_vencimento AS data, SUM(GREATEST(COALESCE(er.valor,0) - COALESCE(er.valor_pago,0), 0)) AS v
      FROM public.erp_receber er
      WHERE er.deleted_at IS NULL AND er.company_id = p_company_id
        AND er.data_vencimento > v_hoje
        AND er.data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
        AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
        AND (v_categoria IS NULL OR er.categoria = v_categoria)
      GROUP BY er.data_vencimento
    ),
    pag_prev AS (
      SELECT ep.data_vencimento AS data, SUM(GREATEST(COALESCE(ep.valor,0) - COALESCE(ep.valor_pago,0), 0)) AS v
      FROM public.erp_pagar ep
      WHERE ep.deleted_at IS NULL AND ep.company_id = p_company_id
        AND ep.data_vencimento > v_hoje
        AND ep.data_vencimento BETWEEN p_data_inicio AND p_data_fim
        AND ep.status NOT IN ('pago', 'cancelado')
        AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                  ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
        AND (v_categoria IS NULL OR ep.categoria = v_categoria)
      GROUP BY ep.data_vencimento
    ),
    -- Transferências não têm categoria: só entram na vista por conta (p_conta_id) sem filtro de categoria.
    transf AS (
      SELECT t.data,
             SUM(CASE WHEN t.conta_destino_id = p_conta_id THEN t.valor ELSE 0 END) AS entrada,
             SUM(CASE WHEN t.conta_origem_id  = p_conta_id THEN t.valor ELSE 0 END) AS saida
      FROM erp_transferencia t
      WHERE t.company_id = p_company_id
        AND t.data BETWEEN p_data_inicio AND p_data_fim
        AND v_categoria IS NULL AND p_conta_id IS NOT NULL
        AND (t.conta_destino_id = p_conta_id OR t.conta_origem_id = p_conta_id)
      GROUP BY t.data
    )
    SELECT
      dias.data,
      (dias.data > v_hoje) AS eh_futuro,
      COALESCE(rec_real.v, 0) AS recebimentos,
      COALESCE(pag_real.v, 0) AS pagamentos,
      CASE WHEN dias.data > v_hoje THEN
        COALESCE(rec_prev.v, 0)
        + CASE WHEN dias.data = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN dias.data > v_hoje THEN
        COALESCE(pag_prev.v, 0)
        + CASE WHEN dias.data = v_primeiro_futuro THEN v_pagar_vencido ELSE 0 END
      ELSE 0 END AS pagamentos_previstos,
      COALESCE(transf.entrada, 0) AS transferencias_entrada,
      COALESCE(transf.saida, 0)   AS transferencias_saida
    FROM dias
    LEFT JOIN rec_real ON rec_real.data = dias.data
    LEFT JOIN pag_real ON pag_real.data = dias.data
    LEFT JOIN rec_prev ON rec_prev.data = dias.data
    LEFT JOIN pag_prev ON pag_prev.data = dias.data
    LEFT JOIN transf   ON transf.data   = dias.data
    ORDER BY dias.data
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

-- check_fn_guards: espelha a ACL viva (postgres, authenticated, service_role; sem anon/PUBLIC)
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) TO authenticated, service_role;
