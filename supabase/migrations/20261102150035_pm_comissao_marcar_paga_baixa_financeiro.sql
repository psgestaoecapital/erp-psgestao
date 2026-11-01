-- PDCA P&M · /dashboard/pm/comissao (aud8 90/95) — conciliação com o financeiro (auditor_pdca_2, 31/10, RD-38).
-- GAP REAL: fn_agency_comissao_marcar_paga só mudava agency_comissao para 'paga' e NÃO dava baixa no
--   erp_pagar vinculado (lancamento_id, criado pelo fn_agency_comissao_aprovar). Resultado: comissão "paga"
--   com a conta a pagar ainda 'aberto' no financeiro — inconsistência.
-- CORREÇÃO: ao marcar a comissão paga, dar baixa no erp_pagar vinculado pela VIA CANÔNICA do financeiro
--   (fn_pagar_registrar_pagamento — mantém valor_pago/status/data_pagamento e o recompute de saldo), nunca
--   um UPDATE direto de status que furaria o razão de pagamentos. Paga o SALDO restante → título fecha em 'pago'.
-- Robustez: se a comissão não tem lancamento_id (seed/legado) ou o título já está pago/cancelado, a comissão
--   ainda é marcada paga (idempotente) sem quebrar; o rastro vai no audit_log_global e no retorno.
-- Aditiva (CREATE OR REPLACE da função; nenhuma coluna/tabela nova; não apaga dado). SENSÍVEL (financeiro)
--   → PR com label revisao-eng-chefe.
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_agency_comissao_marcar_paga(p_comissao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c agency_comissao%ROWTYPE;
  v_uid uuid := auth.uid();
  v_pstatus text;
  v_pvalor numeric;
  v_ppago numeric;
  v_saldo numeric;
  v_baixa jsonb := NULL;
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_comissao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.status = 'paga' THEN
    RETURN jsonb_build_object('ok', true, 'ja_paga', true); END IF;
  IF v_c.status <> 'a_pagar' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'só comissão "a pagar" pode ser marcada paga'); END IF;

  -- Conciliação com o financeiro: baixa o erp_pagar vinculado pela via canônica (razão de pagamentos + recompute).
  IF v_c.lancamento_id IS NOT NULL THEN
    SELECT status, valor, COALESCE(valor_pago, 0) INTO v_pstatus, v_pvalor, v_ppago
      FROM erp_pagar WHERE id = v_c.lancamento_id;
    IF v_pstatus IS NOT NULL AND v_pstatus IN ('aberto', 'parcial', 'vencido') THEN
      v_saldo := round(COALESCE(v_pvalor, 0) - v_ppago, 2);
      IF v_saldo > 0 THEN
        v_baixa := fn_pagar_registrar_pagamento(
          v_c.lancamento_id, current_date, v_saldo, 'PIX', NULL,
          'Baixa automática ao marcar a comissão comercial paga');
      END IF;
    END IF;
  END IF;

  UPDATE agency_comissao
     SET status = 'paga', paga_em = now(), paga_por = v_uid
   WHERE id = p_comissao_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', p_comissao_id,
          'comissao_marcar_paga',
          jsonb_build_object('status', v_c.status, 'lancamento_id', v_c.lancamento_id),
          jsonb_build_object('status', 'paga', 'paga_em', now(), 'paga_por', v_uid, 'baixa_financeiro', v_baixa));

  RETURN jsonb_build_object('ok', true, 'valor', COALESCE(v_c.valor_comissao, 0),
    'pagar_id', v_c.lancamento_id, 'baixa_financeiro', v_baixa);
END;
$function$;

-- Guarda de função SECURITY DEFINER (check_fn_guards · regra 1 · revoke_anon): REVOKE/GRANT explícito,
-- casando com a ACL viva ({authenticated, service_role}; anon/PUBLIC já fora).
REVOKE ALL ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) TO authenticated, service_role;
