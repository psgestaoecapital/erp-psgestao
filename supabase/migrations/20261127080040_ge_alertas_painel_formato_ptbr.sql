-- 20261127070340 · code-desenvolvedor-3 · GE auditoria da agência piloto (Eng. Chefe 25/11), item 4:
-- formato pt-BR nos alertas do Painel GE. Hoje a mensagem sai "R$ 6,548.34" / "R$ 1,575.00" (en-US) porque
-- fn_alertas_gerar_automaticos formata com TO_CHAR(..., 'FM999G999G999D00') — os padrões G/D usam o lc_numeric do
-- servidor (não é pt-BR). Correção locale-INDEPENDENTE: helper fn_fmt_brl que usa os padrões LITERAIS ',' e '.' do
-- TO_CHAR (sempre vírgula-milhar / ponto-decimal) e troca para o pt-BR (ponto-milhar / vírgula-decimal).
-- ADITIVA: helper novo + CREATE OR REPLACE do gerador de alertas trocando SÓ a formatação (lógica financeira
-- idêntica). Não toca dado de cliente. Idempotente.

-- Helper reutilizável: numeric -> "1.234.567,89" (pt-BR), independente de locale.
CREATE OR REPLACE FUNCTION public.fn_fmt_brl(p_valor numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- 'FM999,999,990.00' usa os LITERAIS ',' (milhar) e '.' (decimal) do TO_CHAR; troca-os para o pt-BR.
  SELECT replace(replace(replace(
           to_char(round(coalesce(p_valor, 0), 2), 'FM999,999,999,990.00'),
           ',', '#'), '.', ','), '#', '.');
$$;

REVOKE ALL ON FUNCTION public.fn_fmt_brl(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fmt_brl(numeric) TO authenticated;

-- Gerador de alertas — mesma lógica; só as 4 formatações de R$ passam a usar fn_fmt_brl (pt-BR).
CREATE OR REPLACE FUNCTION public.fn_alertas_gerar_automaticos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo numeric;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  DELETE FROM erp_alerta_proativo
  WHERE company_id = p_company_id
    AND tipo IN ('vencimento_hoje','inadimplencia_critica','saldo_negativo','receber_vencido','pagar_vencido');

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'receber_vencido',
    CASE WHEN MAX(CURRENT_DATE - data_vencimento) > 30 THEN 'critica' ELSE 'alta' END,
    'A receber vencido',
    COUNT(*) || ' cobranca(s) vencida(s) · R$ ' ||
      public.fn_fmt_brl(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))) ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/inadimplentes'
  FROM erp_receber
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('recebido','pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'pagar_vencido', 'alta',
    'A pagar vencido',
    COUNT(*) || ' conta(s) vencida(s) · R$ ' ||
      public.fn_fmt_brl(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))) ||
      ' · maior atraso ' || MAX(CURRENT_DATE - data_vencimento) || ' dia(s)',
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0)),
                       'max_atraso', MAX(CURRENT_DATE - data_vencimento)),
    '/dashboard/financeiro/pagar?filtro=vencido'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento < CURRENT_DATE
  HAVING COUNT(*) > 0;

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT p_company_id, 'vencimento_hoje', 'alta',
    'A pagar hoje',   -- explícito: este alerta é de contas A PAGAR vencendo hoje (o card "A receber hoje" é o outro lado)
    'Voce tem ' || COUNT(*) || ' conta(s) a pagar vencendo hoje totalizando R$ ' ||
      public.fn_fmt_brl(SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))),
    jsonb_build_object('qtd', COUNT(*), 'total', SUM(COALESCE(valor,0) - COALESCE(valor_pago,0))),
    '/dashboard/financeiro/pagar?vencendo=hoje'
  FROM erp_pagar
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND status NOT IN ('pago','cancelado')
    AND data_vencimento = CURRENT_DATE
  HAVING COUNT(*) > 0;

  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'saldo_negativo', 'critica',
      'Saldo bancario negativo',
      'Saldo consolidado em R$ ' || public.fn_fmt_brl(v_saldo) || '. Caixa no vermelho.',
      jsonb_build_object('saldo', v_saldo),
      '/dashboard/cadastros/contas-bancarias');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'gerados', (SELECT COUNT(*) FROM erp_alerta_proativo WHERE company_id = p_company_id AND NOT resolvido AND NOT dispensado));
END; $function$;

-- Guarda de função (check_fn_guards): CREATE OR REPLACE de função SECURITY DEFINER
-- exige REVOKE anon explícito no mesmo arquivo. Mantém os grants de produção (authenticated, service_role).
REVOKE ALL ON FUNCTION public.fn_alertas_gerar_automaticos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_alertas_gerar_automaticos(uuid) TO authenticated, service_role;
