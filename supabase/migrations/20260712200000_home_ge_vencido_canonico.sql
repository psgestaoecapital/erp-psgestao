-- ============================================================
-- PR-FIX HOME GE · FASE 2 — VENCIDO CANÔNICO + NENHUM WIDGET CONTRADIZ OUTRO.
--
-- Regra canônica (única, usada por todos): um título está "pendente" se
--   status IN ('aberto','vencido'); está "vencido" se além disso venc < hoje.
-- (o status='vencido' é setado pelo trg_status_receber/pagar — filtrar só
--  'aberto' escondia todo vencido, dando "inadimplência zerada / tudo em dia".)
--
-- Corrige 4 funções que ainda mentiam:
--   1. fn_ge_saude_financeira  → inadimplência canônica + runway com guarda de
--      caixa negativo + saúde vira CRÍTICA/vermelha quando saldo < 0.
--   2. fn_dashboard_kpis       → a-receber/a-pagar incluem vencidos (não subestima).
--   3. fn_ge_inadimplentes_agrupado → inadimplentes canônicos.
--   4. fn_ge_next_best_action  → antes lia erp_lancamentos + limiar 30d e caía em
--      "Tudo em dia"; agora prioriza saldo negativo e QUALQUER vencido (real,
--      de erp_receber/erp_pagar) antes do fallback.
-- ============================================================

-- 1) SAÚDE FINANCEIRA ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ge_saude_financeira(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_total numeric := 0;
  v_burn_rate_mensal numeric := 0;
  v_meses_caixa numeric := 0;
  v_concentracao_pct numeric := 0;
  v_top_cliente_nome text;
  v_inadimplencia_pct numeric := 0;
  v_inadimplencia_qtd int := 0;
  v_inadimplencia_valor numeric := 0;
  v_score int := 0;
  v_classificacao text;
  v_cor text;
  v_frase_1 text;
  v_frase_2 text;
  v_frase_3 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true, 'mensagem', 'Empresa sem plano GE ativo');
  END IF;

  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT COALESCE(AVG(total_mes), 0) INTO v_burn_rate_mensal
  FROM (
    SELECT DATE_TRUNC('month', data_pagamento) AS mes, SUM(COALESCE(valor_pago, valor)) AS total_mes
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY DATE_TRUNC('month', data_pagamento)
  ) sub;

  v_meses_caixa := CASE WHEN v_burn_rate_mensal > 0
    THEN ROUND(v_saldo_total / v_burn_rate_mensal, 1) ELSE 0 END;

  WITH receitas_por_cliente AS (
    SELECT cliente_id, cliente_nome, SUM(COALESCE(valor_pago, valor)) AS total
    FROM erp_receber
    WHERE company_id = p_company_id AND status='recebido'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days' AND cliente_id IS NOT NULL
    GROUP BY cliente_id, cliente_nome
  ),
  totais AS (SELECT SUM(total) AS total_geral FROM receitas_por_cliente)
  SELECT cliente_nome, ROUND((total / NULLIF(total_geral, 0)) * 100, 0)
  INTO v_top_cliente_nome, v_concentracao_pct
  FROM receitas_por_cliente, totais ORDER BY total DESC LIMIT 1;
  v_concentracao_pct := COALESCE(v_concentracao_pct, 0);

  -- ✅ CANÔNICO: vencido = status IN ('aberto','vencido') AND venc < hoje
  SELECT COUNT(*), COALESCE(SUM(valor), 0)
  INTO v_inadimplencia_qtd, v_inadimplencia_valor
  FROM erp_receber
  WHERE company_id = p_company_id AND status IN ('aberto','vencido')
    AND data_vencimento < CURRENT_DATE;

  WITH base AS (
    SELECT SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status IN ('aberto','vencido') THEN valor ELSE 0 END) AS vencido,
           SUM(valor) AS total
    FROM erp_receber WHERE company_id = p_company_id
  )
  SELECT ROUND((vencido / NULLIF(total, 0)) * 100, 0) INTO v_inadimplencia_pct FROM base;
  v_inadimplencia_pct := COALESCE(v_inadimplencia_pct, 0);

  v_score := LEAST(100, GREATEST(0,
    LEAST(40, ROUND(v_meses_caixa * 7))::int +
    GREATEST(0, 30 - (v_inadimplencia_pct * 0.5))::int +
    GREATEST(0, 30 - (v_concentracao_pct * 0.3))::int
  ));

  -- 🔴 GUARDA: caixa negativo é sempre CRÍTICO (não pode ficar verde/amarelo)
  IF v_saldo_total < 0 THEN
    v_score := LEAST(v_score, 15);
  END IF;

  v_classificacao := CASE WHEN v_score >= 70 THEN 'BOA' WHEN v_score >= 40 THEN 'ATENÇÃO' ELSE 'CRÍTICA' END;
  v_cor := CASE WHEN v_score >= 70 THEN 'verde' WHEN v_score >= 40 THEN 'amarelo' ELSE 'vermelho' END;

  -- 🔴 GUARDA: saldo negativo → "Caixa negativo", nunca "-X meses"
  v_frase_1 := CASE
    WHEN v_saldo_total < 0 THEN 'Caixa NEGATIVO: R$ ' || TO_CHAR(v_saldo_total, 'FM999G999G990D00')
    WHEN v_meses_caixa = 0 THEN 'Sem histórico de pagamentos pra calcular meses de caixa'
    WHEN v_meses_caixa >= 6 THEN 'Caixa cobre ' || v_meses_caixa || ' meses de operação'
    WHEN v_meses_caixa >= 3 THEN 'Caixa cobre ' || v_meses_caixa || ' meses (atenção)'
    ELSE 'Caixa cobre só ' || v_meses_caixa || ' meses (crítico)'
  END;

  v_frase_2 := CASE
    WHEN v_inadimplencia_qtd = 0 THEN 'Inadimplência zerada'
    ELSE 'Inadimplência: ' || v_inadimplencia_qtd || ' contas · R$ ' || TO_CHAR(v_inadimplencia_valor, 'FM999G999G990D00')
  END;

  v_frase_3 := CASE
    WHEN v_top_cliente_nome IS NULL THEN 'Sem dados de concentração de receita ainda'
    WHEN v_concentracao_pct >= 50 THEN 'Concentração alta: ' || v_top_cliente_nome || ' representa ' || v_concentracao_pct || '%'
    WHEN v_concentracao_pct >= 30 THEN 'Maior cliente (' || v_top_cliente_nome || ') = ' || v_concentracao_pct || '% da receita'
    ELSE 'Carteira diversificada (maior cliente = ' || v_concentracao_pct || '%)'
  END;

  RETURN jsonb_build_object(
    'score', v_score, 'classificacao', v_classificacao, 'cor_semaforo', v_cor,
    'meses_caixa', v_meses_caixa, 'saldo_total', v_saldo_total,
    'inadimplencia_pct', v_inadimplencia_pct, 'inadimplencia_qtd', v_inadimplencia_qtd,
    'inadimplencia_valor', v_inadimplencia_valor, 'concentracao_pct', v_concentracao_pct,
    'top_cliente_nome', v_top_cliente_nome,
    'frases', jsonb_build_array(v_frase_1, v_frase_2, v_frase_3)
  );
END; $function$;

-- 2) KPIs DO DASHBOARD (a-receber / a-pagar) ---------------------------------
CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis(p_company_ids uuid[])
RETURNS TABLE(a_receber_valor numeric, a_receber_qtd bigint, a_pagar_valor numeric, a_pagar_qtd bigint, saldo_bancos numeric, mrr_mensal numeric)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT COUNT(*)  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT SUM(valor) FROM erp_pagar   WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    COALESCE((SELECT COUNT(*)  FROM erp_pagar   WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido')), 0),
    fn_saldo_bancos_dinamico(p_company_ids),
    COALESCE((SELECT SUM(
      COALESCE(valor_atual, valor_mensal, 0) * CASE periodicidade
        WHEN 'anual' THEN 1.0/12 WHEN 'semestral' THEN 1.0/6 WHEN 'trimestral' THEN 1.0/3
        WHEN 'bimestral' THEN 1.0/2 ELSE 1 END
    ) FROM erp_contratos WHERE company_id = ANY(p_company_ids) AND status='ativo'), 0)
$function$;

-- 3) INADIMPLENTES AGRUPADO ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ge_inadimplentes_agrupado(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_resumo jsonb; v_clientes jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH base AS (
    SELECT er.cliente_id, er.cliente_nome, er.id, er.descricao, er.valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM erp_receber er
    WHERE er.company_id = p_company_id AND er.status IN ('aberto','vencido') AND er.data_vencimento < CURRENT_DATE
  )
  SELECT jsonb_build_object(
    'qtd_clientes', COALESCE((SELECT COUNT(DISTINCT COALESCE(cliente_id::text, cliente_nome, '')) FROM base), 0),
    'total_qtd_contas', COALESCE((SELECT COUNT(*) FROM base), 0),
    'total_valor', COALESCE((SELECT SUM(valor) FROM base), 0),
    'dias_max_atraso', COALESCE((SELECT MAX(dias_atraso) FROM base), 0)
  ) INTO v_resumo;

  WITH base AS (
    SELECT er.cliente_id, er.cliente_nome, er.id AS conta_id, er.descricao, er.valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM erp_receber er
    WHERE er.company_id = p_company_id AND er.status IN ('aberto','vencido') AND er.data_vencimento < CURRENT_DATE
  ),
  por_cliente AS (
    SELECT cliente_id, cliente_nome, COUNT(*) AS qtd_contas, SUM(valor) AS valor_total,
      MAX(dias_atraso) AS dias_max_atraso, ROUND(AVG(dias_atraso))::int AS dias_medio_atraso,
      jsonb_agg(jsonb_build_object('id', conta_id, 'descricao', descricao, 'valor', valor,
        'vencimento', data_vencimento, 'dias_atraso', dias_atraso) ORDER BY data_vencimento) AS contas
    FROM base GROUP BY cliente_id, cliente_nome
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cliente_id', pc.cliente_id, 'cliente_nome', pc.cliente_nome,
    'cnpj', COALESCE(c.cnpj_cpf, c.cpf_cnpj), 'telefone', COALESCE(c.celular, c.telefone),
    'whatsapp', c.whatsapp, 'email', c.email, 'qtd_contas', pc.qtd_contas, 'valor_total', pc.valor_total,
    'dias_max_atraso', pc.dias_max_atraso, 'dias_medio_atraso', pc.dias_medio_atraso, 'contas', pc.contas
  ) ORDER BY pc.dias_max_atraso DESC, pc.valor_total DESC), '[]'::jsonb) INTO v_clientes
  FROM por_cliente pc LEFT JOIN erp_clientes c ON c.id = pc.cliente_id;

  RETURN jsonb_build_object('company_id', p_company_id, 'resumo', v_resumo, 'clientes', v_clientes);
END; $function$;

-- 4) NEXT BEST ACTION (o 2º "Tudo em dia" do header) -------------------------
CREATE OR REPLACE FUNCTION public.fn_ge_next_best_action(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo numeric;
  v_rec record;
  v_pag record;
  v_qtd_conciliacoes_pendentes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  -- 0) SALDO NEGATIVO — a ação mais urgente
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'caixa',
      'titulo', 'Caixa no vermelho',
      'texto', 'Saldo bancario consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G990D00') ||
               '. Priorize entradas e segure pagamentos nao criticos.',
      'cta_principal', 'Ver contas bancarias', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/contas-bancarias', 'rota_secundaria', '/dashboard/consultor-ia?contexto=caixa');
  END IF;

  -- 1) A RECEBER VENCIDO — qualquer atraso (fonte real: erp_receber, canônico)
  SELECT cliente_nome, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias
  INTO v_rec
  FROM erp_receber
  WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE
  GROUP BY cliente_nome
  ORDER BY MAX(CURRENT_DATE - data_vencimento) DESC, SUM(valor) DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'cobranca',
      'titulo', 'Cobre os vencidos',
      'texto', 'Cobrar ' || COALESCE(v_rec.cliente_nome,'cliente') || ' — atrasado ha ' || v_rec.dias ||
               ' dias, R$ ' || TO_CHAR(v_rec.valor,'FM999G999G990D00') || '. Maior risco da carteira.',
      'cta_principal', 'Ver inadimplentes', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/inadimplentes', 'rota_secundaria', '/dashboard/consultor-ia?contexto=cobranca');
  END IF;

  -- 2) A PAGAR VENCIDO — qualquer atraso
  SELECT COUNT(*) AS qtd, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias
  INTO v_pag
  FROM erp_pagar
  WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE;
  IF v_pag.qtd > 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'pagamento',
      'titulo', 'Contas a pagar vencidas',
      'texto', v_pag.qtd || ' conta(s) vencida(s), R$ ' || TO_CHAR(v_pag.valor,'FM999G999G990D00') ||
               ' · maior atraso ' || v_pag.dias || ' dia(s). Regularize pra evitar juros/negativacao.',
      'cta_principal', 'Ver contas a pagar', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/pagar?filtro=vencido', 'rota_secundaria', '/dashboard/consultor-ia');
  END IF;

  -- 3) CONCILIAÇÕES pendentes
  SELECT COUNT(*) INTO v_qtd_conciliacoes_pendentes
  FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
  WHERE bc.company_id = p_company_id AND cl.status = 'pendente';
  IF v_qtd_conciliacoes_pendentes > 10 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'conciliacao',
      'titulo', 'Concilie o extrato',
      'texto', 'Voce tem ' || v_qtd_conciliacoes_pendentes || ' conciliacoes bancarias pendentes. Resolver isso corrige seus KPIs.',
      'cta_principal', 'Conciliar agora', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/conciliacao', 'rota_secundaria', '/dashboard/consultor-ia?contexto=conciliacao');
  END IF;

  -- 4) Nada urgente
  RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'estavel',
    'titulo', 'Tudo em dia',
    'texto', 'Sem acoes urgentes detectadas. Aproveite pra planejar o proximo mes ou revisar contratos recorrentes.',
    'cta_principal', 'Ver contratos recorrentes', 'cta_secundario', 'Falar com IA',
    'rota_principal', '/dashboard/contratos-recorrentes', 'rota_secundaria', '/dashboard/consultor-ia');
END; $function$;
