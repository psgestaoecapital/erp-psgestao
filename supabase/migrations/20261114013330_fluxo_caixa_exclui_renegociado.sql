-- [Gean/Jordana · Canal PS] Fluxo de caixa não projeta o título original renegociado
--
-- Contexto: o título original de uma conta a receber renegociada fica com status
-- 'renegociado' (em_renegociacao = false, vencido). A projeção do Fluxo de Caixa
-- (fn_fluxo_caixa_diario) listava os títulos a receber em aberto por
--   status NOT IN ('pago','recebido','cancelado')
-- em DOIS pontos — "vencidos em aberto" (projetados no 1º dia futuro como em atraso) e
-- o "previsto" futuro por vencimento. 'renegociado' não estava na lista, então o título
-- já substituído voltava a entrar como recebimento esperado, inflando o caixa previsto e
-- duplicando com os novos títulos da renegociação.
--
-- Prova no dado (RD-38), Gean (a462e13f-0f51-4c54-abe8-4474b591633b), 10/11/2026:
--   vencido-em-aberto projetado = R$ 74.613,97  ·  parcela renegociada que vazava = R$ 1.478,00
--   corrigido = R$ 73.135,97
--
-- Correção ADITIVA e mínima: acrescenta 'renegociado' à lista de status excluídos nos
-- dois filtros de títulos A RECEBER em aberto. Histórico realizado (data_pagamento,
-- pago/recebido), o lado de contas a pagar e as transferências ficam intactos. Só leitura,
-- vale para todas as empresas. Mesma doutrina já aplicada em Receitas a Receber
-- (fn_ge_listagem_v2) e Inadimplência.
--
-- CREATE OR REPLACE de função existente (sensível): vai com revisao-eng-chefe.

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

  -- Saldo inicial: só faz sentido na vista por conta/empresa. Na vista por CATEGORIA mostramos o fluxo líquido da
  -- categoria (acumulado começa em 0), porque o saldo bancário não pertence a uma categoria.
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

  -- Vencidos em aberto (venc < hoje) — projetados no primeiro dia futuro como "em atraso".
  SELECT COALESCE(SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0)), 0)
    INTO v_receber_vencido
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id AND er.data_vencimento < v_hoje
    AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
    AND (v_categoria IS NULL OR er.categoria = v_categoria);

  SELECT COALESCE(SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)), 0)
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
      -- REALIZADO (histórico, por data_pagamento)
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
                  AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
                  AND (v_categoria IS NULL OR ep.categoria = v_categoria)), 0) AS pagamentos,
      -- PREVISTO (futuro, por data_vencimento, títulos em aberto)
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                  WHERE er.company_id = p_company_id AND er.data_vencimento = d::date
                    AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
                    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
                    AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
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

-- check_fn_guards: trava de execução espelhando a ACL viva de hoje
-- (authenticated, service_role; anon/PUBLIC nunca tiveram acesso — nenhuma mudança de acesso).
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) TO authenticated, service_role;
