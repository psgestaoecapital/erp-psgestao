-- Chamado #3961 (Pdois · /dashboard/financeiro/receber; correção vale para todas as empresas) —
-- "Baixa de conta incorreta na conciliação bancária".
--
-- Pedido do cliente: ao conciliar o extrato (ex. Sicredi), o título deve ficar na CONTA DO EXTRATO
-- que está sendo conciliado — não ficar sem conta (previsão lançada sem informar a conta bancária).
--
-- O forward-fix #3866 (20261114120130) já grava a conta do lote no título a receber em DOIS caminhos de
-- fechamento: fn_conciliacao_aplicar_match (match 1:1 "Ouro", o caminho do chamado) e
-- fn_conciliacao_fechar_agrupado (fatura agrupada). Faltou o TERCEIRO caminho que marca
-- erp_receber.conciliado = true: fn_conciliacao_ratear_avulso (rateio de um movimento avulso em vários
-- títulos). Ali o título reconciliava SEM receber a conta_bancaria_id do lote — o mesmo defeito do #3961
-- nesse fluxo. Esta migration fecha esse caminho com o MESMO padrão conservador do #3866:
--   conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta)
-- Só preenche quando está vazia (NUNCA sobrescreve uma conta já informada) e, em lote sem conta bancária,
-- v_conta é NULL e a conta fica como está. erp_pagar NÃO tem coluna conta_bancaria_id, então, como no
-- #3866, o ajuste é só no ramo de receber (ratear_avulso só mexe em erp_receber).
--
-- Mudança MÍNIMA: reproduz a função VIVA idêntica, acrescentando só (1) a declaração v_conta, (2) a leitura
-- da conta do lote do movimento e (3) a coluna no UPDATE de erp_receber. Nenhuma outra linha muda.
-- Backfill de títulos antigos e política de sobrescrever conta já informada ficam para decisão de negócio.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_ratear_avulso(p_movimento_id uuid, p_distribuicao jsonb, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov record; v_comp uuid; v_op uuid := COALESCE(p_operador_id, auth.uid());
  v_item jsonb; v_id uuid; v_valor numeric; v_saldo numeric;
  v_soma numeric := 0; v_alvo numeric;
  v_baixa jsonb; v_r record; v_res jsonb := '[]'::jsonb;
  v_conta uuid;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); END IF;
  v_comp := v_mov.company_id;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_mov.status = 'conciliado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento_ja_conciliado'); END IF;
  IF p_distribuicao IS NULL OR jsonb_typeof(p_distribuicao) <> 'array' OR jsonb_array_length(p_distribuicao) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'distribuicao_vazia'); END IF;

  -- #3961: conta bancária do lote do movimento, para gravar no título a receber (como no #3866)
  SELECT conta_bancaria_id INTO v_conta FROM conciliacao_lote WHERE id = v_mov.lote_id;

  v_alvo := round(abs(v_mov.valor), 2);

  -- 1) VALIDAÇÃO (antes de mexer em nada): item válido, título da empresa, valor <= saldo, soma == alvo.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_distribuicao) LOOP
    v_id := NULLIF(btrim(v_item->>'lancamento_id'), '')::uuid;
    v_valor := round(COALESCE((v_item->>'valor')::numeric, 0), 2);
    IF v_id IS NULL OR v_valor <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'item_invalido', 'item', v_item); END IF;

    SELECT round(valor - COALESCE(valor_pago, 0), 2) INTO v_saldo
      FROM erp_receber WHERE id = v_id AND company_id = v_comp AND deleted_at IS NULL AND status <> 'pago';
    IF v_saldo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'titulo_nao_encontrado_ou_pago', 'lancamento_id', v_id); END IF;
    IF v_valor > v_saldo + 0.01 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'valor_excede_saldo',
        'lancamento_id', v_id, 'valor', v_valor, 'saldo', v_saldo); END IF;

    v_soma := round(v_soma + v_valor, 2);
  END LOOP;

  IF abs(v_soma - v_alvo) > 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'distribuicao_nao_fecha',
      'valor_movimento', v_alvo, 'soma_distribuida', v_soma, 'diferenca', round(v_alvo - v_soma, 2)); END IF;

  -- 2) APLICAÇÃO (atômica). Baixa parcial por título + carimba conciliação; erro reverte tudo.
  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_distribuicao) LOOP
      v_id := (v_item->>'lancamento_id')::uuid;
      v_valor := round((v_item->>'valor')::numeric, 2);

      v_baixa := fn_receber_baixar_pagamento(v_id, v_mov.data_transacao::date, NULL, 'PIX', v_valor);
      IF NOT COALESCE((v_baixa->>'sucesso')::boolean, false) THEN
        RAISE EXCEPTION 'falha_baixa % : %', v_id, COALESCE(v_baixa->>'erro', 'desconhecido'); END IF;

      INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
      VALUES (p_movimento_id, v_comp, 'erp_receber', v_id, v_valor, v_op)
      ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE SET valor_vinculado = EXCLUDED.valor_vinculado;

      -- #3961: além de marcar conciliado, grava a conta do extrato quando o título ainda não tem conta
      UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta), updated_at = now() WHERE id = v_id;

      SELECT * INTO v_r FROM erp_receber WHERE id = v_id;
      v_res := v_res || jsonb_build_object(
        'lancamento_id', v_id, 'valor_baixa', v_valor, 'status_novo', v_r.status,
        'valor_pago', v_r.valor_pago, 'saldo_restante', GREATEST(round(v_r.valor - COALESCE(v_r.valor_pago, 0), 2), 0));
    END LOOP;

    UPDATE conciliacao_movimento SET status = 'conciliado', match_origem = 'rateio_avulso',
      match_aplicado_em = now(), match_aplicado_por = v_op WHERE id = p_movimento_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar', 'detalhe', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'movimento_id', p_movimento_id, 'valor_movimento', v_alvo,
    'qtd_titulos', jsonb_array_length(p_distribuicao), 'titulos', v_res);
END;
$function$;

-- check_fn_guards (Regra 1): REVOKE anon na fn SECURITY DEFINER. Espelha a ACL viva de hoje
-- {postgres(owner), authenticated, service_role}; anon/PUBLIC nunca tiveram acesso — nenhuma mudança de acesso.
REVOKE ALL ON FUNCTION public.fn_conciliacao_ratear_avulso(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_ratear_avulso(uuid, jsonb, uuid) TO authenticated, service_role;
