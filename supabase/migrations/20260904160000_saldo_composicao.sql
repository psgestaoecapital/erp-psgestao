-- BPO · Composição do saldo (chamados #23 Julia, #25 Jordana) — SÓ LEITURA, não muda cálculo.
-- "A tela não explica" — duas pessoas do BPO perguntaram como o saldo é composto em 30min.
-- Mostra, por conta: saldo_inicial (na SUA data) + recebido − pago = saldo. E expõe a DATA EFETIVA
-- que o cálculo atual usa (MIN(data_saldo_inicial) company-wide) — se divergir da data da conta, a
-- própria tela mostra o bug do saldo (Cresol 31/08 filtrado desde 31/07). O fix per-conta vem depois.

CREATE OR REPLACE FUNCTION public.fn_saldo_composicao(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_data_efetiva date;           -- a data que fn_saldo_bancos_dinamico USA hoje (MIN company-wide)
  v_contas jsonb; v_sem jsonb;
  v_ti numeric; v_tr numeric; v_tp numeric; v_gerencial numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE v_ids := p_company_ids; END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN jsonb_build_object('sem_acesso', true); END IF;

  -- data efetiva do cálculo ATUAL (o que o fix vai corrigir): a mais antiga entre as contas que somam
  SELECT MIN(data_saldo_inicial) INTO v_data_efetiva
  FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);

  -- composição CORRETA por conta: cada conta usa a SUA própria data
  SELECT jsonb_agg(row_to_json(t) ORDER BY t.saldo_inicial DESC) INTO v_contas FROM (
    SELECT bc.id AS conta_id, bc.nome, bc.tipo_conta,
      bc.saldo_inicial, bc.data_saldo_inicial,
      (bc.data_saldo_inicial IS DISTINCT FROM v_data_efetiva) AS data_diverge_do_calculo,
      COALESCE((SELECT SUM(COALESCE(er.valor_pago, er.valor)) FROM erp_receber er
        WHERE er.conta_bancaria_id = bc.id AND er.status IN ('recebido','pago')
          AND er.data_pagamento >= bc.data_saldo_inicial), 0) AS recebido,
      COALESCE((SELECT SUM(COALESCE(ep.valor_pago, ep.valor)) FROM erp_pagar ep
        WHERE ep.conta_bancaria = bc.nome AND ep.status = 'pago'
          AND ep.data_pagamento >= bc.data_saldo_inicial), 0) AS pago,
      (bc.saldo_inicial
        + COALESCE((SELECT SUM(COALESCE(er.valor_pago, er.valor)) FROM erp_receber er
            WHERE er.conta_bancaria_id = bc.id AND er.status IN ('recebido','pago') AND er.data_pagamento >= bc.data_saldo_inicial),0)
        - COALESCE((SELECT SUM(COALESCE(ep.valor_pago, ep.valor)) FROM erp_pagar ep
            WHERE ep.conta_bancaria = bc.nome AND ep.status = 'pago' AND ep.data_pagamento >= bc.data_saldo_inicial),0)
      ) AS saldo
    FROM erp_banco_contas bc
    WHERE bc.company_id = ANY(v_ids) AND bc.ativo AND COALESCE(bc.soma_no_saldo,true)
  ) t;

  -- títulos SEM conta atribuída (não somem — aparecem à parte; é o que o rateio por conta não alcança)
  SELECT jsonb_build_object(
    'recebido', COALESCE((SELECT SUM(COALESCE(valor_pago,valor)) FROM erp_receber
       WHERE company_id = ANY(v_ids) AND status IN ('recebido','pago') AND conta_bancaria_id IS NULL
         AND data_pagamento >= v_data_efetiva),0),
    'pago', COALESCE((SELECT SUM(COALESCE(valor_pago,valor)) FROM erp_pagar
       WHERE company_id = ANY(v_ids) AND status='pago'
         AND (conta_bancaria IS NULL OR conta_bancaria NOT IN (SELECT nome FROM erp_banco_contas WHERE company_id=ANY(v_ids)))
         AND data_pagamento >= v_data_efetiva),0)
  ) INTO v_sem;

  SELECT COALESCE(SUM(saldo_inicial),0) INTO v_ti FROM erp_banco_contas WHERE company_id=ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  v_gerencial := public.fn_saldo_bancos_dinamico(v_ids);
  v_tr := COALESCE((SELECT SUM((c->>'recebido')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'recebido')::numeric,0);
  v_tp := COALESCE((SELECT SUM((c->>'pago')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'pago')::numeric,0);

  RETURN jsonb_build_object('ok', true,
    'data_efetiva_calculo_atual', v_data_efetiva,
    'contas', COALESCE(v_contas,'[]'::jsonb),
    'sem_conta', v_sem,
    'total_saldo_inicial', v_ti, 'total_recebido', v_tr, 'total_pago', v_tp,
    'saldo_composto', v_ti + v_tr - v_tp,
    'saldo_gerencial_atual', COALESCE(v_gerencial,0));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_saldo_composicao(uuid[]) TO authenticated;
