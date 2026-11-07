-- Conciliação grava a conta do EXTRATO no título (jordana-code · chamado #3961, Pdois — vale para todas as empresas)
--
-- Defeito: ao conciliar um movimento de um extrato (ex.: SICREDI) com um título a pagar/receber, a baixa era criada,
-- mas o título ficava com a conta informada no cadastro — ou sem conta nenhuma. Como o saldo por conta
-- (fn_saldo_gerencial_contas) lê a conta do TÍTULO (erp_receber.conta_bancaria_id; erp_pagar.conta_bancaria pelo nome),
-- o dinheiro conciliado no Sicredi caía em "Sem conta" ou na conta errada.
-- Prova (21/10, todas as empresas, conciliados nos últimos 30 dias): 83 a pagar e 96 a receber sem conta; 4 a receber
-- com conta diferente da do extrato. Pdois: tarifa 8cab34d4 (R$ 0,90) conciliada no SICREDI PRIGOL e ainda sem conta.
--
-- Regra (especificação da Jordana, mensagem 740eeb50):
--   1. o título conciliado com movimento de extrato bancário passa a ter a conta desse extrato (a do movimento
--      conciliado mais recente, se houver mais de um) e o histórico do título registra
--      "Conta alterada de X para Y pela conciliação" (erp_lancamento_log, acao CONTA_PELA_CONCILIACAO);
--   2. a troca só acontece quando TODAS as baixas ativas do título são dinheiro deste extrato (as que a própria
--      conciliação criou). Se houver qualquer baixa que não é deste extrato (manual solta, ou ligada a movimento de
--      outra conta) — com ou sem conta informada no título —, NÃO troca: grava só o aviso
--      CONCILIACAO_CONTA_DIVERGENTE no histórico (uma vez por conta de extrato) para o operador confirmar.
--      Assim nenhum pagamento já registrado fora deste extrato muda de conta (revisão 27/10, RD-55).
-- Prova só leitura (27/10, todas as empresas, títulos hoje conciliados): se a recompute rodasse para todos, trocaria
-- 178 a pagar e 133 a receber (todas as baixas vindas do extrato) e deixaria aviso em 4 a receber (sem conta, com
-- baixa fora do extrato — antes seriam trocados). Esta migration não altera nenhum título: a regra vale a partir do
-- próximo match/recompute.
-- Lote sem conta bancária (cartão) não mexe. Desvincular não volta a conta. Só a partir de agora: o histórico já
-- conciliado NÃO é alterado aqui (a correção dos casos antigos de Prigol/Troian/Gean é migration de dado à parte).

CREATE OR REPLACE FUNCTION public.fn_titulo_conta_pela_conciliacao(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_conta uuid; v_nome text; v_atual_id uuid; v_atual_nome text; v_company uuid; v_outra boolean;
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
    SELECT t.company_id, t.conta_bancaria_id, t.conta_bancaria INTO v_company, v_atual_id, v_atual_nome
      FROM public.erp_receber t WHERE t.id = p_id;
    -- baixa ativa que NÃO é dinheiro deste extrato (manual solta, ou ligada a movimento de outra conta)
    SELECT EXISTS (SELECT 1 FROM public.erp_receber_baixa b
                     LEFT JOIN public.conciliacao_movimento m ON m.id = b.movimento_banco_id
                     LEFT JOIN public.conciliacao_lote l ON l.id = m.lote_id
                    WHERE b.receber_id = p_id AND b.deleted_at IS NULL
                      AND l.conta_bancaria_id IS DISTINCT FROM v_conta) INTO v_outra;
  ELSE
    SELECT t.company_id, NULL::uuid, t.conta_bancaria INTO v_company, v_atual_id, v_atual_nome
      FROM public.erp_pagar t WHERE t.id = p_id;
    SELECT EXISTS (SELECT 1 FROM public.erp_pagar_baixa b
                     LEFT JOIN public.conciliacao_movimento m ON m.id = b.movimento_banco_id
                     LEFT JOIN public.conciliacao_lote l ON l.id = m.lote_id
                    WHERE b.pagar_id = p_id AND b.deleted_at IS NULL
                      AND l.conta_bancaria_id IS DISTINCT FROM v_conta) INTO v_outra;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_banco_contas bc WHERE bc.id = v_conta AND bc.company_id = v_company) THEN RETURN; END IF;

  -- já está na conta do extrato
  IF (p_tabela = 'erp_receber' AND v_atual_id IS NOT DISTINCT FROM v_conta AND v_atual_nome IS NOT DISTINCT FROM v_nome)
     OR (p_tabela = 'erp_pagar' AND v_atual_nome IS NOT DISTINCT FROM v_nome) THEN
    RETURN;
  END IF;

  -- título com qualquer baixa que não é deste extrato: não troca (pagamento já registrado), só deixa o aviso
  IF v_outra THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, tabela_origem, user_email, acao, campos_alterados)
    SELECT p_id, p_tabela, (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), 'CONCILIACAO_CONTA_DIVERGENTE',
           jsonb_build_object('conta_bancaria', jsonb_build_object('atual', v_atual_nome, 'extrato', v_nome),
                              'motivo', 'Conciliado no extrato de ' || v_nome || ', mas o título tem baixa fora deste extrato (conta do título: '
                                        || COALESCE(NULLIF(btrim(v_atual_nome), ''), 'sem conta') || '). Conta mantida: confirme a troca.')
     WHERE NOT EXISTS (SELECT 1 FROM public.erp_lancamento_log g
                        WHERE g.lancamento_id = p_id AND g.acao = 'CONCILIACAO_CONTA_DIVERGENTE'
                          AND g.campos_alterados->'conta_bancaria'->>'extrato' = v_nome);
    RETURN;
  END IF;

  IF p_tabela = 'erp_receber' THEN
    UPDATE public.erp_receber t
       SET conta_bancaria_id = v_conta, conta_bancaria = v_nome, updated_at = now()
     WHERE t.id = p_id;
  ELSE
    UPDATE public.erp_pagar t
       SET conta_bancaria = v_nome, updated_at = now()
     WHERE t.id = p_id;
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, tabela_origem, user_email, acao, campos_alterados)
  VALUES (p_id, p_tabela, (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), 'CONTA_PELA_CONCILIACAO',
          jsonb_build_object('conta_bancaria', jsonb_build_object('de', v_atual_nome, 'para', v_nome),
                             'motivo', 'Conta alterada de ' || COALESCE(NULLIF(btrim(v_atual_nome), ''), 'sem conta')
                                       || ' para ' || v_nome || ' pela conciliação'));
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

-- mesmo acesso de produção (só service_role; o gatilho roda como dono): explícito para a guarda de funções
REVOKE ALL ON FUNCTION public.fn_recompute_baixa_titulo(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_baixa_titulo(text, uuid) TO service_role;
