-- ============================================================
-- Dashboard Consolidado — 3 correções de tela (auditoria Eng Chefe). Dado OK.
-- Aplicada via MCP · RD-41.
--
-- (1) fn_grupo_aberto_por_empresa: agrega A Receber/A Pagar ABERTO + saldo
--     bancário POR empresa no SQL. O front somava linhas client-side e o cap de
--     1000 linhas do PostgREST truncava as empresas grandes (Tryo Gesso: 1486
--     títulos de pagar → soma parava em ~4,5mi; real 10,1mi). Agregando no banco
--     não há truncamento.
--
-- (2) fn_psgc_painel_operacional: os "Saldos Bancários" liam
--     fn_saldo_bancos_dinamico (≈−1.016 p/ Tryo) e RATEAVAM o total por
--     saldo_inicial → toda conta em −127,08 (alerta falso "caixa no vermelho").
--     Agora lê erp_banco_contas.saldo_atual REAL por conta (Transferências 414k,
--     Caixinha 392k, Bradesco 161k…). Só o bloco de saldo muda; resto intacto.
-- ============================================================

-- (1) Agregado ABERTO + saldo por empresa (consolida N empresas, guard de escopo)
CREATE OR REPLACE FUNCTION public.fn_grupo_aberto_por_empresa(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_admin boolean := public.is_admin();
  v_out   jsonb;
  v_tot   jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_empresas');
  END IF;
  IF NOT v_admin AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas');
  END IF;

  WITH ids AS (SELECT unnest(p_company_ids) AS company_id),
  rec AS (SELECT company_id, SUM(valor) v FROM erp_receber
          WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido') GROUP BY company_id),
  pag AS (SELECT company_id, SUM(valor) v FROM erp_pagar
          WHERE company_id = ANY(p_company_ids) AND status IN ('aberto','vencido') GROUP BY company_id),
  sal AS (SELECT company_id, SUM(COALESCE(saldo_atual,0)) v FROM erp_banco_contas
          WHERE company_id = ANY(p_company_ids) AND COALESCE(ativo,true) AND COALESCE(soma_no_saldo,true) GROUP BY company_id),
  base AS (
    SELECT i.company_id, COALESCE(c.nome_fantasia, c.razao_social) AS nome,
           COALESCE(rec.v,0) AS receber, COALESCE(pag.v,0) AS pagar, COALESCE(sal.v,0) AS saldo
    FROM ids i JOIN companies c ON c.id = i.company_id
    LEFT JOIN rec ON rec.company_id = i.company_id
    LEFT JOIN pag ON pag.company_id = i.company_id
    LEFT JOIN sal ON sal.company_id = i.company_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'company_id', company_id, 'nome_fantasia', nome,
           'receber_aberto', round(receber,2), 'pagar_aberto', round(pagar,2), 'saldo_bancario', round(saldo,2)
         ) ORDER BY (receber + pagar) DESC),
         jsonb_build_object('receber', round(SUM(receber),2), 'pagar', round(SUM(pagar),2), 'saldo', round(SUM(saldo),2))
    INTO v_out, v_tot
  FROM base;

  RETURN jsonb_build_object('ok', true,
    'por_empresa', COALESCE(v_out, '[]'::jsonb),
    'totais', COALESCE(v_tot, jsonb_build_object('receber',0,'pagar',0,'saldo',0)));
END $function$;
REVOKE ALL ON FUNCTION public.fn_grupo_aberto_por_empresa(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_grupo_aberto_por_empresa(uuid[]) TO authenticated;

-- (2) Saldos Bancários = saldo_atual REAL (não mais rateio do fn_saldo_bancos_dinamico)
CREATE OR REPLACE FUNCTION public.fn_psgc_painel_operacional(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_fim_30d date := CURRENT_DATE + INTERVAL '30 days';
  v_fim_mes date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
  v_receber_vencidos jsonb; v_receber_hoje jsonb; v_receber_30d jsonb; v_receber_mes jsonb;
  v_pagar_vencidos jsonb; v_pagar_hoje jsonb; v_pagar_30d jsonb; v_pagar_mes jsonb;
  v_saldos_bancarios jsonb; v_saldo_total numeric;
  v_conciliacoes_qtd int; v_conciliacoes_valor numeric; v_alertas_imediatos jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('erro', 'sem_empresas');
  END IF;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_receber_vencidos FROM (
    SELECT cliente_nome, valor, data_vencimento FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('cliente', cliente_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_receber_hoje FROM (
    SELECT cliente_nome, valor FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje
      AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_30d
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_receber_mes
  FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes
    AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor,
      'vencimento', data_vencimento, 'dias_atraso', (CURRENT_DATE - data_vencimento))
      ORDER BY (CURRENT_DATE - data_vencimento) DESC), '[]'::jsonb))
  INTO v_pagar_vencidos FROM (
    SELECT fornecedor_nome, valor, data_vencimento FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*),
    'top5', COALESCE(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'valor', valor)), '[]'::jsonb))
  INTO v_pagar_hoje FROM (
    SELECT fornecedor_nome, valor FROM erp_pagar
    WHERE company_id = ANY(p_company_ids) AND data_vencimento = v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY valor DESC LIMIT 5) top;
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_30d
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_30d
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));
  SELECT jsonb_build_object('valor', COALESCE(SUM(valor), 0), 'qtd', COUNT(*)) INTO v_pagar_mes
  FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento > v_hoje AND data_vencimento <= v_fim_mes
    AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'));

  -- ✅ FIX (2): saldo REAL por conta (erp_banco_contas.saldo_atual), sem rateio.
  SELECT COALESCE(SUM(COALESCE(saldo_atual,0)),0) INTO v_saldo_total
  FROM erp_banco_contas WHERE company_id = ANY(p_company_ids) AND ativo = true AND COALESCE(soma_no_saldo, true) = true;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conta', bc.nome,
      'saldo', ROUND(COALESCE(bc.saldo_atual,0), 2),
      'entradas_acum', 0, 'saidas_acum', 0, 'ultima_movimentacao', bc.updated_at
    ) ORDER BY bc.nome), '[]'::jsonb)
  INTO v_saldos_bancarios
  FROM erp_banco_contas bc WHERE bc.company_id = ANY(p_company_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true;

  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO v_conciliacoes_qtd, v_conciliacoes_valor
  FROM (
    SELECT valor FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    UNION ALL
    SELECT valor FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_pagamento IS NULL
      AND data_vencimento <= CURRENT_DATE AND (status IS NULL OR status NOT IN ('recebido','pago','cancelado','CANCELADO'))
  ) pendentes;
  WITH criticos AS (
    SELECT 'pagar' AS tipo, 'critico' AS severidade, fornecedor_nome AS pessoa, valor, data_vencimento,
      (CURRENT_DATE - data_vencimento) AS dias_atraso,
      CASE WHEN (CURRENT_DATE - data_vencimento) > 90 THEN '🚨 Vencido há +90 dias — risco de protesto'
           WHEN (CURRENT_DATE - data_vencimento) > 30 THEN '⚠️ Vencido há +30 dias — juros/multa acumulando'
           ELSE '📅 Vencido recentemente' END AS mensagem
    FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento < v_hoje
      AND (status IS NULL OR status NOT IN ('pago','cancelado','CANCELADO'))
    ORDER BY (CURRENT_DATE - data_vencimento) DESC, valor DESC LIMIT 5)
  SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'severidade', severidade, 'pessoa', pessoa,
    'valor', valor, 'vencimento', data_vencimento, 'dias_atraso', dias_atraso, 'mensagem', mensagem))
  INTO v_alertas_imediatos FROM criticos;
  RETURN jsonb_build_object('gerado_em', NOW(), 'data_referencia', v_hoje,
    'empresas_consideradas', array_length(p_company_ids, 1),
    'cards_hero', jsonb_build_object(
      'receber_vencidos', v_receber_vencidos, 'receber_hoje', v_receber_hoje,
      'receber_30d', v_receber_30d, 'receber_resto_mes', v_receber_mes,
      'pagar_vencidos', v_pagar_vencidos, 'pagar_hoje', v_pagar_hoje,
      'pagar_30d', v_pagar_30d, 'pagar_resto_mes', v_pagar_mes),
    'saldos_bancarios', jsonb_build_object(
      'total', COALESCE(ROUND(v_saldo_total::numeric, 2), 0),
      'qtd_contas', COALESCE(jsonb_array_length(v_saldos_bancarios), 0),
      'contas', COALESCE(v_saldos_bancarios, '[]'::jsonb)),
    'conciliacoes_pendentes', jsonb_build_object('qtd', v_conciliacoes_qtd, 'valor_estimado', ROUND(v_conciliacoes_valor::numeric, 2)),
    'alertas_imediatos', COALESCE(v_alertas_imediatos, '[]'::jsonb));
END; $function$;
