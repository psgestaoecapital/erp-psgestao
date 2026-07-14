-- P0 #6 · PR-B · exclusão AUDITADA + GUARDADA de lançamentos e movimentações + trava
-- ============================================================================
-- PR-A (#643) travou salário + receber/pagar. Faltavam erp_lancamentos e
-- erp_movimentacoes — que têm caminho de UI de delete (operacional deleteLanc)
-- e, no caso de erp_movimentacoes, NENHUM audit trigger (delete traceless).
--
-- Padrão idêntico ao fn_receber_excluir: RPC SECURITY DEFINER que checa empresa,
-- aplica guarda de NEGÓCIO, GRAVA auditoria, abre o escape e deleta. A trava
-- (fn_bloqueia_delete_fisico, de #643) barra qualquer DELETE cru dessas tabelas.
-- Nada de UI chama /api/financeiro (verificado) → travar não quebra tela.
-- ============================================================================

-- Lançamento pago não se exclui (documento com dinheiro reconhecido) — igual à
-- guarda dos contratos ("boleto/pago não exclui, só cancela").
CREATE OR REPLACE FUNCTION public.fn_lancamento_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_registro jsonb; v_status text; v_valor_pago numeric; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(l.*), l.status, l.valor_pago, l.company_id
    INTO v_registro, v_status, v_valor_pago, v_company_id
  FROM public.erp_lancamentos l WHERE l.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR COALESCE(v_valor_pago,0) > 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_pago',
      'orientacao', 'Lançamento pago não pode ser excluído. Estorne o pagamento antes.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro, 'motivo', p_motivo), 'erp_lancamentos');

  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM public.erp_lancamentos WHERE id = p_id;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

-- Movimentação conciliada não se exclui (bate com extrato/banco). E como a tabela
-- NÃO tem audit trigger, esta RPC é o ÚNICO lugar que deixa rastro do delete.
CREATE OR REPLACE FUNCTION public.fn_movimentacao_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_registro jsonb; v_conciliado boolean; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(m.*), m.conciliado, m.company_id
    INTO v_registro, v_conciliado, v_company_id
  FROM public.erp_movimentacoes m WHERE m.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado',
      'orientacao', 'Movimentação conciliada com o banco. Desconcilie antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro, 'motivo', p_motivo), 'erp_movimentacoes');

  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM public.erp_movimentacoes WHERE id = p_id;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_lancamento_excluir(uuid, text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_movimentacao_excluir(uuid, text) TO authenticated, service_role;

-- Estende a trava (fn_bloqueia_delete_fisico já existe do #643) às duas tabelas.
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_lancamentos;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_lancamentos
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_movimentacoes;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_movimentacoes
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();
