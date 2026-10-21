-- Conciliação grava a conta do EXTRATO no título (jordana-code · chamado #3961, Pdois — vale para todas as empresas)
--
-- Defeito: ao conciliar um movimento de um extrato (ex.: SICREDI) com um título a pagar/receber, a baixa era criada,
-- mas o título ficava com a conta informada no cadastro — ou sem conta nenhuma. Como o saldo por conta
-- (fn_saldo_gerencial_contas) lê a conta do TÍTULO (erp_receber.conta_bancaria_id; erp_pagar.conta_bancaria pelo nome),
-- o dinheiro conciliado no Sicredi caía em "Sem conta" ou na conta errada.
-- Prova (21/10, todas as empresas, conciliados nos últimos 30 dias): 83 a pagar e 96 a receber sem conta; 4 a receber
-- com conta diferente da do extrato. Pdois: tarifa 8cab34d4 (R$ 0,90) conciliada no SICREDI PRIGOL e ainda sem conta.
--
-- Regra: o título conciliado com movimento de extrato bancário passa a ter a conta desse extrato (a do movimento
-- conciliado mais recente, se houver mais de um). Lote sem conta bancária (cartão) não mexe. Desvincular não volta a
-- conta. Só a partir de agora: o histórico já conciliado NÃO é alterado aqui (correção em massa = decisão à parte).

CREATE OR REPLACE FUNCTION public.fn_titulo_conta_pela_conciliacao(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_conta uuid; v_nome text;
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;

  -- movimento conciliado mais recente deste título (1:1 ou por vínculo), de lote com conta bancária da MESMA empresa
  SELECT bc.id, bc.nome INTO v_conta, v_nome
    FROM public.conciliacao_movimento m
    JOIN public.conciliacao_lote l ON l.id = m.lote_id
    JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id AND bc.company_id = m.company_id
   WHERE m.status = 'conciliado'
     AND ( (m.lancamento_tabela = p_tabela AND m.lancamento_id = p_id)
        OR EXISTS (SELECT 1 FROM public.conciliacao_vinculo v
                    WHERE v.movimento_id = m.id AND v.lancamento_tabela = p_tabela AND v.lancamento_id = p_id) )
   ORDER BY m.data_transacao DESC, m.match_aplicado_em DESC NULLS LAST, m.id DESC
   LIMIT 1;
  IF v_conta IS NULL THEN RETURN; END IF;

  IF p_tabela = 'erp_receber' THEN
    UPDATE public.erp_receber t
       SET conta_bancaria_id = v_conta, conta_bancaria = v_nome, updated_at = now()
     WHERE t.id = p_id
       AND (t.conta_bancaria_id IS DISTINCT FROM v_conta OR t.conta_bancaria IS DISTINCT FROM v_nome)
       AND EXISTS (SELECT 1 FROM public.erp_banco_contas bc WHERE bc.id = v_conta AND bc.company_id = t.company_id);
  ELSE
    UPDATE public.erp_pagar t
       SET conta_bancaria = v_nome, updated_at = now()
     WHERE t.id = p_id
       AND t.conta_bancaria IS DISTINCT FROM v_nome
       AND EXISTS (SELECT 1 FROM public.erp_banco_contas bc WHERE bc.id = v_conta AND bc.company_id = t.company_id);
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.fn_titulo_conta_pela_conciliacao(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_titulo_conta_pela_conciliacao(text, uuid) TO service_role;

-- fn_recompute_baixa_titulo: definição viva de 21/10 + o passo da conta no fim (chamado pelo gatilho de
-- conciliacao_movimento em todo match, agrupado, rateio e desvínculo)
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
        v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  IF p_tabela = 'erp_receber' THEN SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_id;
  ELSE SELECT company_id INTO v_company FROM public.erp_pagar WHERE id = p_id; END IF;
  IF v_company IS NULL THEN RETURN; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  -- baixas são a fonte; a conciliação nunca sobrescreve o pagamento já registrado (#38 receber · pagar)
  IF p_tabela = 'erp_receber' THEN
    PERFORM public.fn_receber_conciliacao_sync(p_id);
  ELSE
    PERFORM public.fn_pagar_conciliacao_sync(p_id);
  END IF;

  -- o título conciliado fica na conta do extrato (#3961)
  PERFORM public.fn_titulo_conta_pela_conciliacao(p_tabela, p_id);
END $function$;
