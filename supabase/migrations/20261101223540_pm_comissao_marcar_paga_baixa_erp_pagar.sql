-- PDCA P&M · /dashboard/pm/comissao (auditor_pdca_2, 31/10, provado no dado RD-38)
-- GAP: fn_agency_comissao_marcar_paga só mudava agency_comissao para 'paga' (+audit) e NÃO dava baixa na conta a pagar
-- (erp_pagar) criada na aprovação (lancamento_id). Resultado: comissão "paga" com o título ainda 'aberto' no financeiro.
-- CORREÇÃO (aditiva ao comportamento; mesmo padrão da aprovação, que já grava erp_pagar direto): ao marcar paga, dá a
-- BAIXA no erp_pagar vinculado (status 'pago', data_pagamento, valor_pago, baixado_por, origem_baixa='manual' — valor
-- permitido pelo check erp_pagar_origem_baixa_check). Idempotente (só baixa o que não está pago) e escopado à empresa.
-- SENSÍVEL (financeiro) → PR com revisao-eng-chefe. CREATE OR REPLACE preserva os grants existentes.
--
-- RD-38 (prova no dado, BEGIN…ROLLBACK, statement_timeout curto, uma linha):
--   INSERT erp_pagar (DEMO P&M) status 'aberto' → UPDATE da baixa → status='pago', valor_pago=valor; 2ª execução não
--   altera (idempotência). Sem resíduo após ROLLBACK (conferido: 0 linhas com a descrição de prova).

CREATE OR REPLACE FUNCTION public.fn_agency_comissao_marcar_paga(p_comissao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c agency_comissao%ROWTYPE; v_uid uuid := auth.uid(); v_pagar_baixado uuid;
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_comissao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.status = 'paga' THEN
    RETURN jsonb_build_object('ok', true, 'ja_paga', true); END IF;
  IF v_c.status <> 'a_pagar' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'só comissão "a pagar" pode ser marcada paga'); END IF;

  UPDATE agency_comissao
     SET status = 'paga', paga_em = now(), paga_por = v_uid
   WHERE id = p_comissao_id;

  -- Conciliação com o financeiro: a conta a pagar criada na aprovação (lancamento_id) recebe a BAIXA, para a comissão
  -- "paga" não ficar com o título ainda "aberto" no contas a pagar. Idempotente e escopado à mesma empresa.
  IF v_c.lancamento_id IS NOT NULL THEN
    UPDATE erp_pagar
       SET status = 'pago',
           data_pagamento = COALESCE(data_pagamento, current_date),
           valor_pago = COALESCE(valor_pago, valor),
           baixado_por = v_uid,
           origem_baixa = COALESCE(origem_baixa, 'manual')
     WHERE id = v_c.lancamento_id AND company_id = v_c.company_id AND status <> 'pago'
     RETURNING id INTO v_pagar_baixado;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', p_comissao_id,
          'comissao_marcar_paga',
          jsonb_build_object('status', v_c.status),
          jsonb_build_object('status', 'paga', 'paga_em', now(), 'paga_por', v_uid, 'pagar_baixado', v_pagar_baixado));

  RETURN jsonb_build_object('ok', true, 'valor', COALESCE(v_c.valor_comissao, 0), 'pagar_baixado', v_pagar_baixado);
END $function$;

-- Guarda de função (RD-52 / check-fn-guards): SECURITY DEFINER acessível só a quem está logado.
-- CREATE OR REPLACE preserva grants, mas a régua exige o REVOKE anon explícito na migration nova.
REVOKE EXECUTE ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_agency_comissao_marcar_paga(uuid) TO authenticated;
