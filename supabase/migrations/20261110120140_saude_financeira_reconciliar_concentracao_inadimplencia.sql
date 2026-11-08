-- PDCA GE · /dashboard/financeiro/saude — reconciliar Concentração de receita e Inadimplência
-- (auditor_pdca_2, critério "e": números não batem na própria tela).
--
-- Gap 1 (Concentração): o KPI "Concentração receita" mostrava "—" (fn_ge_saude_financeira filtrava
--   status='recebido', que NÃO existe em erp_receber — títulos recebidos usam status='pago'), enquanto
--   o Alerta Proativo IA (fn_saude_alertas_proativos, status IN ('pago','recebido')) afirmava
--   "Top cliente representa 56,3% da receita". Contradição direta.
-- Gap 2 (Inadimplência): o KPI usava status IN ('aberto','vencido') (9% / 25 contas) e o Alerta usava
--   status NOT IN ('pago','recebido','cancelado') (11,6%). Universos diferentes = dois números na mesma tela.
--
-- Correção: as DUAS funções passam a usar a MESMA definição, canônica:
--   • Receita recebida   = status IN ('pago','recebido'), data_pagamento >= hoje-90d, COALESCE(valor_pago,valor).
--   • Concentração       = maior cliente REAL (cliente_id NOT NULL) ÷ TOTAL recebido (avulso no denominador),
--                          arredondado a 1 casa. O balcão/avulso (sem cliente) não é tratado como "1 cliente".
--   • Inadimplência      = status IN ('aberto','vencido') e vencido (data_vencimento < hoje), igual ao KPI.
--
-- Aditiva: apenas CREATE OR REPLACE de duas funções de LEITURA (SECURITY DEFINER com guarda de empresa e
-- checagem de plano preservadas). Não altera dado de cliente, RLS, grants nem título pago. RD-38 provado no
-- PR (Comércio (GE)-DEMO: antes "—" vs 56,3% / 9% vs 11,6% → depois 56,3%=56,3% / 9%=9%).

CREATE OR REPLACE FUNCTION public.fn_ge_saude_financeira(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_total numeric := 0; v_burn_rate_mensal numeric := 0; v_meses_caixa numeric := 0;
  v_concentracao_pct numeric := 0; v_top_cliente_nome text;
  v_inadimplencia_pct numeric := 0; v_inadimplencia_qtd int := 0; v_inadimplencia_valor numeric := 0;
  v_score int := 0; v_classificacao text; v_cor text; v_frase_1 text; v_frase_2 text; v_frase_3 text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true, 'mensagem', 'Empresa sem plano GE ativo');
  END IF;
  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  SELECT COALESCE(AVG(total_mes), 0) INTO v_burn_rate_mensal
  FROM (SELECT DATE_TRUNC('month', data_pagamento) AS mes, SUM(COALESCE(valor_pago, valor)) AS total_mes
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '3 months' GROUP BY DATE_TRUNC('month', data_pagamento)) sub;
  v_meses_caixa := CASE WHEN v_burn_rate_mensal > 0 THEN ROUND(v_saldo_total / v_burn_rate_mensal, 1) ELSE 0 END;
  -- Concentração: maior cliente REAL ÷ TOTAL recebido (avulso/sem-cliente conta no denominador, não como "1 cliente").
  WITH recebidos AS (
    SELECT cliente_id, cliente_nome, COALESCE(valor_pago, valor) AS v
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status IN ('pago','recebido')
      AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days'),
  total_recebido AS (SELECT SUM(v) AS total_geral FROM recebidos),
  por_cliente AS (SELECT cliente_nome, SUM(v) AS total FROM recebidos WHERE cliente_id IS NOT NULL GROUP BY cliente_id, cliente_nome)
  SELECT cliente_nome, ROUND((total / NULLIF((SELECT total_geral FROM total_recebido), 0)) * 100, 1)
  INTO v_top_cliente_nome, v_concentracao_pct
  FROM por_cliente ORDER BY total DESC LIMIT 1;
  v_concentracao_pct := COALESCE(v_concentracao_pct, 0);
  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_inadimplencia_qtd, v_inadimplencia_valor
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE;
  WITH base AS (SELECT SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status IN ('aberto','vencido') THEN valor ELSE 0 END) AS vencido,
           SUM(valor) AS total FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id)
  SELECT ROUND((vencido / NULLIF(total, 0)) * 100, 0) INTO v_inadimplencia_pct FROM base;
  v_inadimplencia_pct := COALESCE(v_inadimplencia_pct, 0);
  v_score := LEAST(100, GREATEST(0, LEAST(40, ROUND(v_meses_caixa * 7))::int +
    GREATEST(0, 30 - (v_inadimplencia_pct * 0.5))::int + GREATEST(0, 30 - (v_concentracao_pct * 0.3))::int));
  IF v_saldo_total < 0 THEN v_score := LEAST(v_score, 15); END IF;
  v_classificacao := CASE WHEN v_score >= 70 THEN 'BOA' WHEN v_score >= 40 THEN 'ATENÇÃO' ELSE 'CRÍTICA' END;
  v_cor := CASE WHEN v_score >= 70 THEN 'verde' WHEN v_score >= 40 THEN 'amarelo' ELSE 'vermelho' END;
  v_frase_1 := CASE
    WHEN v_saldo_total < 0 THEN 'Caixa NEGATIVO: R$ ' || TO_CHAR(v_saldo_total, 'FM999G999G990D00')
    WHEN v_meses_caixa = 0 THEN 'Sem histórico de pagamentos pra calcular meses de caixa'
    WHEN v_meses_caixa >= 6 THEN 'Caixa cobre ' || v_meses_caixa || ' meses de operação'
    WHEN v_meses_caixa >= 3 THEN 'Caixa cobre ' || v_meses_caixa || ' meses (atenção)'
    ELSE 'Caixa cobre só ' || v_meses_caixa || ' meses (crítico)' END;
  v_frase_2 := CASE WHEN v_inadimplencia_qtd = 0 THEN 'Inadimplência zerada'
    ELSE 'Inadimplência: ' || v_inadimplencia_qtd || ' contas · R$ ' || TO_CHAR(v_inadimplencia_valor, 'FM999G999G990D00') END;
  v_frase_3 := CASE WHEN v_top_cliente_nome IS NULL THEN 'Sem dados de concentração de receita ainda'
    WHEN v_concentracao_pct >= 50 THEN 'Concentração alta: ' || v_top_cliente_nome || ' representa ' || v_concentracao_pct || '%'
    WHEN v_concentracao_pct >= 30 THEN 'Maior cliente (' || v_top_cliente_nome || ') = ' || v_concentracao_pct || '% da receita'
    ELSE 'Carteira diversificada (maior cliente = ' || v_concentracao_pct || '%)' END;
  RETURN jsonb_build_object('score', v_score, 'classificacao', v_classificacao, 'cor_semaforo', v_cor,
    'meses_caixa', v_meses_caixa, 'saldo_total', v_saldo_total, 'inadimplencia_pct', v_inadimplencia_pct,
    'inadimplencia_qtd', v_inadimplencia_qtd, 'inadimplencia_valor', v_inadimplencia_valor,
    'concentracao_pct', v_concentracao_pct, 'top_cliente_nome', v_top_cliente_nome,
    'frases', jsonb_build_array(v_frase_1, v_frase_2, v_frase_3));
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_saude_alertas_proativos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_despesa_mensal numeric;
  v_meses_caixa numeric;
  v_inadimplencia_pct numeric;
  v_concentracao_cliente jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]);

  SELECT COALESCE(SUM(valor_pago), 0) / 3.0 INTO v_despesa_mensal
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
  WHERE company_id = p_company_id
    AND data_pagamento > CURRENT_DATE - INTERVAL '90 days'
    AND status = 'pago';

  v_meses_caixa := CASE WHEN v_despesa_mensal > 0
                        THEN v_saldo / v_despesa_mensal
                        ELSE NULL END;

  -- Alerta 1 · Meses de caixa
  IF v_meses_caixa IS NOT NULL AND v_meses_caixa < 1 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Caixa baixo',
      'mensagem', FORMAT('Você tem menos de 1 mês de caixa (%s meses). Risco operacional alto.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Reduza despesas não-essenciais E acelere recebimentos.'
    );
  ELSIF v_meses_caixa IS NOT NULL AND v_meses_caixa < 3 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Reserva limitada',
      'mensagem', FORMAT('Você tem %s meses de caixa. Recomendado: pelo menos 3 meses.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Considere reservar % do faturamento mensal.'
    );
  END IF;

  -- Alerta 2 · Inadimplência — MESMO universo do KPI (status IN ('aberto','vencido'), vencido), arredondado igual (inteiro)
  SELECT
    CASE WHEN SUM(valor) > 0
         THEN ROUND(SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status IN ('aberto','vencido') THEN valor ELSE 0 END) * 100.0 / SUM(valor), 0)
         ELSE 0 END
  INTO v_inadimplencia_pct
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id;

  IF v_inadimplencia_pct > 10 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Inadimplência alta',
      'mensagem', FORMAT('%s%% da carteira está inadimplente.', v_inadimplencia_pct::int),
      'acao_sugerida', 'Priorize cobrança ativa nas atrasadas acima de 30 dias.'
    );
  END IF;

  -- Alerta 3 · Concentração receita — MESMA definição do KPI: maior cliente REAL ÷ TOTAL recebido (avulso no denominador)
  WITH recebidos AS (
    SELECT cliente_id, COALESCE(valor_pago, valor) AS v
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id
      AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days'
      AND status IN ('pago', 'recebido')
  ),
  total_receita AS (SELECT SUM(v) AS total FROM recebidos),
  por_cliente AS (SELECT cliente_id, SUM(v) AS total FROM recebidos WHERE cliente_id IS NOT NULL GROUP BY cliente_id)
  SELECT jsonb_build_object(
    'cliente_top_id', cliente_id,
    'pct', ROUND(total / NULLIF((SELECT total FROM total_receita), 0) * 100, 1)
  )
  INTO v_concentracao_cliente
  FROM por_cliente
  ORDER BY total DESC
  LIMIT 1;

  IF (v_concentracao_cliente ->> 'pct')::numeric > 40 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Concentração de receita',
      'mensagem', FORMAT('Top cliente representa %s%% da receita. Risco de dependência.', v_concentracao_cliente ->> 'pct'),
      'acao_sugerida', 'Diversifique base de clientes.'
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_atual', v_saldo,
    'despesa_mensal_media', v_despesa_mensal,
    'meses_caixa', v_meses_caixa,
    'inadimplencia_pct', v_inadimplencia_pct,
    'concentracao_top_cliente', v_concentracao_cliente,
    'total_alertas', jsonb_array_length(v_alertas),
    'alertas', v_alertas
  );
END;
$function$;
