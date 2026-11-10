-- Núcleo financeiro · Fluxo de caixa (/dashboard/financeiro/fluxo-caixa) · PDCA auditor_pdca_2 (37c2b8df, aud8 92/95)
-- BUG LATENTE provado (RD-38): quando p_conta_id é informado, fn_fluxo_caixa_diario NÃO filtra os MOVIMENTOS por
-- conta — a condição `(p_conta_id IS NOT NULL OR NOT EXISTS(... incluir_no_fluxo=false))` curto-circuita para TRUE e
-- conta nenhuma é aplicada. Resultado: total_recebimentos/total_pagamentos idênticos para qualquer conta; só o
-- saldo_inicial muda. Hoje é latente (a UI mandava p_conta_id=null fixo); vira NÚMERO ERRADO ao ligar o seletor de conta.
-- CORREÇÃO: dois ramos explícitos —
--   p_conta_id IS NULL  → "Todas": exclui só contas com incluir_no_fluxo=false (comportamento de hoje, preservado);
--   p_conta_id NOT NULL → só os títulos daquela conta (receber por conta_bancaria_id; pagar por nome da conta).
-- O nome da conta é resolvido UMA vez em v_conta_nome (evita subquery por linha). Sem mudar o caminho "Todas".
-- Núcleo financeiro, CREATE OR REPLACE sensível → revisao-eng-chefe. STABLE/somente leitura; prova RD-38 em BEGIN/ROLLBACK.

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
  v_hoje date := CURRENT_DATE;
  v_primeiro_futuro date := GREATEST(CURRENT_DATE + 1, p_data_inicio);
  v_receber_vencido numeric;
  v_pagar_vencido numeric;
  v_conta_nome text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- Nome da conta escolhida (para o filtro de pagar, que guarda a conta como texto). Uma vez só.
  IF p_conta_id IS NOT NULL THEN
    SELECT lower(nome) INTO v_conta_nome FROM erp_banco_contas WHERE id = p_conta_id AND company_id = p_company_id;
  END IF;

  SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
    INTO v_saldo_inicial, v_data_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true
    AND (p_conta_id IS NULL OR id = p_conta_id);

  v_saldo_acumulado := v_saldo_inicial;

  -- Vencidos em aberto (venc < hoje) — projetados no primeiro dia futuro como "em atraso".
  SELECT COALESCE(SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0)), 0)
    INTO v_receber_vencido
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id AND er.data_vencimento < v_hoje
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))
         OR (p_conta_id IS NOT NULL AND er.conta_bancaria_id = p_conta_id));

  SELECT COALESCE(SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)), 0)
    INTO v_pagar_vencido
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
  WHERE ep.company_id = p_company_id AND ep.data_vencimento < v_hoje
    AND ep.status NOT IN ('pago', 'cancelado')
    AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))
         OR (p_conta_id IS NOT NULL AND lower(ep.conta_bancaria) = v_conta_nome));

  FOR v_dia IN
    SELECT
      d::date AS data,
      (d::date > v_hoje) AS eh_futuro,
      -- REALIZADO (histórico, por data_pagamento)
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')
                  AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))
                       OR (p_conta_id IS NOT NULL AND er.conta_bancaria_id = p_conta_id))), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'
                  AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))
                       OR (p_conta_id IS NOT NULL AND lower(ep.conta_bancaria) = v_conta_nome))), 0) AS pagamentos,
      -- PREVISTO (futuro, por data_vencimento, títulos em aberto) — só dias > hoje; vencidos no 1º dia futuro
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                  WHERE er.company_id = p_company_id AND er.data_vencimento = d::date
                    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
                    AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))
                         OR (p_conta_id IS NOT NULL AND er.conta_bancaria_id = p_conta_id))), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                  WHERE ep.company_id = p_company_id AND ep.data_vencimento = d::date
                    AND ep.status NOT IN ('pago', 'cancelado')
                    AND ((p_conta_id IS NULL AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))
                         OR (p_conta_id IS NOT NULL AND lower(ep.conta_bancaria) = v_conta_nome))), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_pagar_vencido ELSE 0 END
      ELSE 0 END AS pagamentos_previstos,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
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

-- RD-98 p3 · origem do dado (idempotente, sem duplicar)
UPDATE public.system_screens
   SET rpcs_chamadas = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(COALESCE(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_fluxo_caixa_diario']::text[]) AS x)
 WHERE rota = '/dashboard/financeiro/fluxo-caixa'
   AND NOT ('fn_fluxo_caixa_diario' = ANY (COALESCE(rpcs_chamadas, ARRAY[]::text[])));

-- RD-95 · "?" do seletor de conta e da exportação
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.fluxo_caixa.conta','Fluxo de caixa','Conta',
 'Escolha uma conta para ver só o caixa dela, ou "Todas as contas" para o consolidado da empresa.',
 'Com uma conta selecionada, saldo inicial, entradas, saídas e as transferências passam a ser só daquela conta. "Todas" soma as contas marcadas para entrar no fluxo.',
 'Ver quanto entra e sai só na conta do Banco do Brasil este mês.',
 'Comparar o saldo de uma conta com o extrato do banco sem lembrar que "Todas" mistura as contas.',
 1,'/dashboard/financeiro/fluxo-caixa','gestao_empresarial','publicado'),
('ge.fluxo_caixa.exportar','Fluxo de caixa','Exportar',
 'Clique para baixar o fluxo do período em planilha (CSV).',
 'Leva os dias, entradas, saídas, transferências, movimento e saldo para o Excel, para conferência ou relatório.',
 'Exportar os 30 dias e mandar para o contador.',
 'Esperar que o arquivo some os valores sozinho: ele traz as linhas; a soma você faz na planilha.',
 2,'/dashboard/financeiro/fluxo-caixa','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
