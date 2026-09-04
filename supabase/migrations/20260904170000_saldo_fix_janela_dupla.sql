-- BPO · Fix do saldo gerencial — subtrai a JANELA DUPLA (chamados #23 Julia / #25 Jordana)
-- BUG: fn_saldo_bancos_dinamico somava saldo_inicial de TODAS as contas mas filtrava títulos por
-- MIN(data_saldo_inicial) company-wide. Conta com saldo de data mais NOVA que o MIN tem seus títulos
-- no intervalo [MIN, data_da_conta) já dentro do saldo_inicial dela E contados de novo → dupla contagem.
-- RÉGUA (auto-escopante, provada empresa a empresa — das 21, só Proplay +25.079,24 e Ps Gestao LTDA
-- -1,00 mudam; 19 byte a byte): para conta com saldo_inicial>0 E data > MIN, subtrai a janela dela.
-- Receber por conta_bancaria_id (exato); pagar por nome só quando casa EXATAMENTE 1 conta (cuidado #1).
-- Conta de saldo 0 não tem assinatura. Empresa sem assinatura → subtração 0 → idêntico ao de hoje.

CREATE OR REPLACE FUNCTION public.fn_saldo_bancos_dinamico(p_company_ids uuid[])
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH saldos_iniciais AS (
    SELECT bc.company_id, bc.id, bc.nome, bc.saldo_inicial, bc.data_saldo_inicial
    FROM erp_banco_contas bc
    WHERE bc.company_id = ANY(p_company_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true
  ),
  mins AS (SELECT company_id, MIN(data_saldo_inicial) mn FROM saldos_iniciais GROUP BY 1),
  nome_ct AS (SELECT company_id, lower(btrim(nome)) nkey, count(*) n FROM saldos_iniciais GROUP BY 1,2),
  total_saldo_inicial AS (SELECT COALESCE(SUM(saldo_inicial),0) AS total FROM saldos_iniciais),
  total_receber AS (
    SELECT COALESCE(SUM(COALESCE(er.valor_pago, er.valor, 0)),0) AS total FROM erp_receber er
    WHERE er.company_id = ANY(p_company_ids) AND er.data_pagamento IS NOT NULL AND er.status IN ('recebido','pago')
      AND er.data_pagamento >= COALESCE((SELECT mn FROM mins WHERE company_id = er.company_id), '1900-01-01'::date)
  ),
  total_pagar AS (
    SELECT COALESCE(SUM(COALESCE(ep.valor_pago, ep.valor, 0)),0) AS total FROM erp_pagar ep
    WHERE ep.company_id = ANY(p_company_ids) AND ep.data_pagamento IS NOT NULL AND ep.status = 'pago'
      AND ep.data_pagamento >= COALESCE((SELECT mn FROM mins WHERE company_id = ep.company_id), '1900-01-01'::date)
  ),
  janela_dupla AS (
    SELECT COALESCE(SUM(
        COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er
          WHERE er.conta_bancaria_id = s.id AND er.status IN ('recebido','pago')
            AND er.data_pagamento >= m.mn AND er.data_pagamento < s.data_saldo_inicial),0)
      - COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep
          WHERE lower(btrim(ep.conta_bancaria)) = lower(btrim(s.nome)) AND ep.status='pago'
            AND (SELECT n FROM nome_ct WHERE company_id=s.company_id AND nkey=lower(btrim(s.nome)))=1
            AND ep.data_pagamento >= m.mn AND ep.data_pagamento < s.data_saldo_inicial),0)
      ),0) AS total
    FROM saldos_iniciais s JOIN mins m ON m.company_id = s.company_id
    WHERE s.saldo_inicial > 0 AND s.data_saldo_inicial > m.mn
  )
  SELECT (SELECT total FROM total_saldo_inicial) + (SELECT total FROM total_receber)
       - (SELECT total FROM total_pagar) - (SELECT total FROM janela_dupla);
$function$;

-- Composição: cada conta com assinatura ganha `janela_subtraida` (a dupla contagem removida) para a
-- tela mostrar de onde vem a diferença — se o saldo da Proplay muda R$25k, a Julia vê a linha (exig. #4).
CREATE OR REPLACE FUNCTION public.fn_saldo_composicao(p_company_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_data_efetiva date; v_contas jsonb; v_sem jsonb; v_ti numeric; v_tr numeric; v_tp numeric; v_gerencial numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE v_ids := p_company_ids; END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN jsonb_build_object('sem_acesso', true); END IF;
  SELECT MIN(data_saldo_inicial) INTO v_data_efetiva FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  SELECT jsonb_agg(row_to_json(t) ORDER BY t.saldo_inicial DESC) INTO v_contas FROM (
    SELECT bc.id AS conta_id, bc.nome, bc.saldo_inicial, bc.data_saldo_inicial,
      (bc.data_saldo_inicial IS DISTINCT FROM v_data_efetiva) AS data_diverge_do_calculo,
      (bc.saldo_inicial > 0 AND bc.data_saldo_inicial > v_data_efetiva) AS tem_assinatura,
      -- janela dupla que a régua subtrai (só p/ contas com assinatura): [MIN, data_da_conta)
      CASE WHEN bc.saldo_inicial > 0 AND bc.data_saldo_inicial > v_data_efetiva THEN
        COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er WHERE er.conta_bancaria_id=bc.id AND er.status IN ('recebido','pago') AND er.data_pagamento>=v_data_efetiva AND er.data_pagamento<bc.data_saldo_inicial),0)
        - COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep WHERE lower(btrim(ep.conta_bancaria))=lower(btrim(bc.nome)) AND ep.status='pago' AND ep.data_pagamento>=v_data_efetiva AND ep.data_pagamento<bc.data_saldo_inicial),0)
      ELSE 0 END AS janela_subtraida,
      COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er WHERE er.conta_bancaria_id=bc.id AND er.status IN ('recebido','pago') AND er.data_pagamento>=bc.data_saldo_inicial),0) AS recebido,
      COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep WHERE ep.conta_bancaria=bc.nome AND ep.status='pago' AND ep.data_pagamento>=bc.data_saldo_inicial),0) AS pago,
      (bc.saldo_inicial + COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er WHERE er.conta_bancaria_id=bc.id AND er.status IN ('recebido','pago') AND er.data_pagamento>=bc.data_saldo_inicial),0)
        - COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep WHERE ep.conta_bancaria=bc.nome AND ep.status='pago' AND ep.data_pagamento>=bc.data_saldo_inicial),0)) AS saldo
    FROM erp_banco_contas bc WHERE bc.company_id=ANY(v_ids) AND bc.ativo AND COALESCE(bc.soma_no_saldo,true)) t;
  SELECT jsonb_build_object(
    'recebido', COALESCE((SELECT SUM(COALESCE(valor_pago,valor)) FROM erp_receber WHERE company_id=ANY(v_ids) AND status IN ('recebido','pago') AND conta_bancaria_id IS NULL AND data_pagamento>=v_data_efetiva),0),
    'pago', COALESCE((SELECT SUM(COALESCE(valor_pago,valor)) FROM erp_pagar WHERE company_id=ANY(v_ids) AND status='pago' AND (conta_bancaria IS NULL OR conta_bancaria NOT IN (SELECT nome FROM erp_banco_contas WHERE company_id=ANY(v_ids))) AND data_pagamento>=v_data_efetiva),0)) INTO v_sem;
  SELECT COALESCE(SUM(saldo_inicial),0) INTO v_ti FROM erp_banco_contas WHERE company_id=ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  v_gerencial := public.fn_saldo_bancos_dinamico(v_ids);
  v_tr := COALESCE((SELECT SUM((c->>'recebido')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'recebido')::numeric,0);
  v_tp := COALESCE((SELECT SUM((c->>'pago')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'pago')::numeric,0);
  RETURN jsonb_build_object('ok',true,'data_efetiva_calculo_atual',v_data_efetiva,'contas',COALESCE(v_contas,'[]'::jsonb),'sem_conta',v_sem,
    'total_saldo_inicial',v_ti,'total_recebido',v_tr,'total_pago',v_tp,'saldo_composto',v_ti+v_tr-v_tp,
    'total_janela_subtraida', COALESCE((SELECT SUM((c->>'janela_subtraida')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0),
    'saldo_gerencial_atual',COALESCE(v_gerencial,0));
END $function$;
