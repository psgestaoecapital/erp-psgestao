-- ============================================================
-- PR-FIX HOME GE · FASE 1 (PARAR DE MENTIR) — vale para TODAS as empresas.
--
-- O banner "✅ Tudo em dia" (FaixaAlertas.tsx) aparece quando v_alertas_ativos
-- retorna 0 linhas. O gerador fn_alertas_gerar_automaticos só criava alerta para:
--   • pagar vencendo EXATAMENTE hoje
--   • inadimplência > 30 dias
-- e o tipo 'saldo_negativo' era DELETADO mas NUNCA inserido.
-- Resultado: uma empresa com R$16.960 a receber vencido há 2 dias, 1 conta a
-- pagar vencida e saldo bancário −R$23.870 mostrava "Tudo em dia". MENTIRA.
--
-- FIX: o gerador passa a criar alerta para QUALQUER vencido (receber/pagar) e
-- para saldo bancário negativo. O banner deixa de mentir sem tocar no frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_alertas_gerar_automaticos(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo numeric;
BEGIN
  -- limpa os auto-gerados (todos os tipos que esta função mantém)
  DELETE FROM erp_alerta_proativo
  WHERE company_id = p_company_id
    AND tipo IN ('vencimento_hoje','inadimplencia_critica','saldo_negativo','receber_vencido','pagar_vencido');

  -- 1) A RECEBER VENCIDO — QUALQUER atraso (antes: só > 30 dias)
  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'receber_vencido',
    CASE WHEN MAX(CURRENT_DATE - data_vencimento) > 30 THEN 'critica' ELSE 'alta' END,
    'A receber vencido',
    COUNT(*) || ' cobranca(s) vencida(s) · R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00') ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/inadimplentes'
  FROM erp_receber
  WHERE company_id = p_company_id
    AND status NOT IN ('recebido','pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  -- 2) A PAGAR VENCIDO — QUALQUER atraso (antes: só vencendo hoje)
  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'pagar_vencido', 'alta',
    'A pagar vencido',
    COUNT(*) || ' conta(s) vencida(s) · R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00') ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/pagar?filtro=vencido'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  -- 3) CONTAS A PAGAR VENCENDO HOJE (mantido)
  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'vencimento_hoje', 'alta',
    'Contas vencem hoje',
    'Voce tem ' || COUNT(*) || ' conta(s) vencendo hoje totalizando R$ ' ||
      TO_CHAR(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)), 'FM999G999G999D00'),
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))),
    '/dashboard/financeiro/pagar?vencendo=hoje'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento = CURRENT_DATE
  HAVING COUNT(*) > 0;

  -- 4) SALDO BANCARIO NEGATIVO — antes DELETAVA mas nunca INSERIA
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'saldo_negativo', 'critica',
      'Saldo bancario negativo',
      'Saldo consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G999D00') || '. Caixa no vermelho.',
      jsonb_build_object('saldo', v_saldo),
      '/dashboard/contas-bancarias');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'gerados', (SELECT COUNT(*) FROM erp_alerta_proativo WHERE company_id = p_company_id AND NOT resolvido AND NOT dispensado));
END; $function$;
