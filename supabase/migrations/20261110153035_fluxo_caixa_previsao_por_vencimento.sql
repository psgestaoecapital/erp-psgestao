-- Gestão Empresarial · Fluxo de Caixa · PREVISÃO POR VENCIMENTO (PDCA auditor_pdca_2 · 09/11)
-- GAP (provado no dado RD-38, DEMO Comércio GE b0700000-0000-4000-a000-000000000004):
--   fn_fluxo_caixa_diario referenciava erp_receber/erp_pagar SÓ por data_pagamento (realizado).
--   Logo os dias FUTUROS (sem pagamento ainda) ficavam SEMPRE zerados — "previsão de caixa oca".
--   Havia R$38.006,43 a receber em aberto com vencimento >= hoje e R$28.850,58 vencidos em aberto
--   que NUNCA apareciam no gráfico/lista, induzindo o usuário a erro de decisão de caixa.
--
-- FIX (núcleo financeiro · CREATE OR REPLACE de função existente = SENSÍVEL · revisao-eng-chefe):
--   - PASSADO/HOJE (d <= hoje): continua REALIZADO por data_pagamento (lógica inalterada, não
--     reescreve histórico com valor não recebido). Mantém o "Saldo Atual" honesto (caixa real).
--   - FUTURO (d > hoje): PROJETA títulos EM ABERTO por data_vencimento (receber = entrada prevista,
--     pagar = saída prevista). Vencidos em aberto (venc < hoje) entram no primeiro dia futuro como
--     "a receber/pagar em atraso" (dinheiro agendado que ainda deve entrar/sair), sem distorcer o
--     saldo de hoje.
--   - Separa realizado de previsto no retorno (recebimentos_previstos/pagamentos_previstos + eh_futuro
--     por dia; total_*_previstos e total_*_vencido_aberto no topo) para a UI distinguir (linha
--     sólida = realizado; tracejada = previsão).
--   - Preserva EXATAMENTE os filtros de conta (incluir_no_fluxo / p_conta_id) e o cálculo realizado.
--
-- Faixa de migration do code-desenvolvedor-3 (segundos :35). Aditiva de comportamento (não altera
-- schema, não toca dado de cliente). Também adiciona as chaves de ajuda "?" (RD-95) dos novos indicadores.

CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(
  p_company_id uuid,
  p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date,
  p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date,
  p_conta_id uuid DEFAULT NULL::uuid)
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
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

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
    AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false));

  SELECT COALESCE(SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)), 0)
    INTO v_pagar_vencido
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
  WHERE ep.company_id = p_company_id AND ep.data_vencimento < v_hoje
    AND ep.status NOT IN ('pago', 'cancelado')
    AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)));

  FOR v_dia IN
    SELECT
      d::date AS data,
      (d::date > v_hoje) AS eh_futuro,
      -- REALIZADO (histórico, por data_pagamento) — INALTERADO
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
      -- PREVISTO (futuro, por data_vencimento, títulos em aberto) — só dias > hoje; vencidos no 1º dia futuro
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                  WHERE er.company_id = p_company_id AND er.data_vencimento = d::date
                    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
                    AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false))), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                  WHERE ep.company_id = p_company_id AND ep.data_vencimento = d::date
                    AND ep.status NOT IN ('pago', 'cancelado')
                    AND (p_conta_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)))), 0)
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

-- Guarda RD/CI (check-fn-guards): função SECURITY DEFINER não fica aberta ao anon.
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) TO authenticated, service_role;

-- RD-95: "?" dos novos indicadores de previsão (idempotente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/fluxo-caixa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.fluxo_caixa.kpi.previsto_entrar', 'Indicadores', 'Previsto a entrar',
  'Nada a preencher: é a soma dos recebimentos AINDA EM ABERTO cujo vencimento cai nos dias à frente da janela (inclui os já vencidos que ainda não entraram).',
  'Antecipa quanto deve entrar no caixa no período, para você planejar antes de faltar dinheiro.',
  'R$ 19.246,84 em títulos a receber com vencimento nos próximos 30 dias.',
  'Tratar como já recebido: é previsão por vencimento — só entra de fato quando o cliente paga.', 12),
 ('ge.fluxo_caixa.kpi.previsto_sair', 'Indicadores', 'Previsto a sair',
  'Nada a preencher: é a soma dos pagamentos AINDA EM ABERTO cujo vencimento cai nos dias à frente da janela (inclui os já vencidos que ainda não saíram).',
  'Antecipa quanto você precisa pagar no período, para não ser pego de surpresa.',
  'R$ 1.844,90 em contas a pagar com vencimento nos próximos 30 dias.',
  'Tratar como já pago: é previsão por vencimento — só sai de fato quando você paga.', 13),
 ('ge.fluxo_caixa.legenda_previsto', 'Indicadores', 'Realizado × Previsto',
  'Nada a preencher: a parte sólida do gráfico (até hoje) é o REALIZADO; a parte tracejada (a partir de amanhã) é a PREVISÃO por vencimento dos títulos em aberto.',
  'Deixa claro o que já aconteceu e o que ainda depende de pagamentos acontecerem.',
  'Até hoje a linha é cheia; depois de hoje vira tracejada (projeção).',
  'Ler o futuro tracejado como certo: é projeção pelos vencimentos, não caixa confirmado.', 14)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
