-- Estoque: ajuste de saldo para MIGRAÇÃO pela planilha padrão (contexto 9c43a93d).
-- Por que uma função nova (e não fn_movimentar_estoque): a movimentação tem CHECK
-- chk_estoque_quantidade_positiva (quantidade > 0) e fn_movimentar_estoque bloqueia saldo final < 0
-- (exceto 'inventario', que grava quantidade = p_quantidade e por isso também não aceita negativo).
-- A migração precisa ACEITAR saldo NEGATIVO. Esta função grava a movimentação com quantidade = |delta|
-- (positiva, respeita o CHECK) e tipo ajuste_positivo/ajuste_negativo, deixando estoque_atual no ALVO
-- (pode ser negativo). Idempotente: delta 0 → nenhuma movimentação.
-- RDs 25·26·38·52·65. Nasce blindada (REVOKE anon + guarda de empresa).

CREATE OR REPLACE FUNCTION public.fn_estoque_ajuste_migracao(p_produto_id uuid, p_saldo_alvo numeric, p_custo numeric DEFAULT NULL, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_atual numeric; v_delta numeric; v_tipo text; v_mov uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT company_id, COALESCE(estoque_atual, 0) INTO v_comp, v_atual FROM erp_produtos WHERE id = p_produto_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'produto nao encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  v_delta := round(p_saldo_alvo - v_atual, 3);
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('ok', true, 'ajustado', false, 'de', v_atual, 'para', v_atual);
  END IF;
  v_tipo := CASE WHEN v_delta > 0 THEN 'ajuste_positivo' ELSE 'ajuste_negativo' END;
  INSERT INTO erp_estoque_movimentacoes (
    company_id, produto_id, local_id, tipo, motivo,
    quantidade, quantidade_antes, quantidade_depois,
    custo_unitario, valor_total, ref_tipo, usuario_id, data_movimento
  ) VALUES (
    v_comp, p_produto_id, NULL, v_tipo, COALESCE(p_motivo, 'Migração de estoque · planilha padrão PS'),
    abs(v_delta), v_atual, p_saldo_alvo,
    COALESCE(p_custo, 0), COALESCE(p_custo, 0) * abs(v_delta), 'migracao_estoque_ps', auth.uid(), now()
  ) RETURNING id INTO v_mov;
  UPDATE erp_produtos SET estoque_atual = p_saldo_alvo, updated_at = now() WHERE id = p_produto_id;
  RETURN jsonb_build_object('ok', true, 'ajustado', true, 'de', v_atual, 'para', p_saldo_alvo, 'movimento_id', v_mov);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.fn_estoque_ajuste_migracao(uuid, numeric, numeric, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_estoque_ajuste_migracao(uuid, numeric, numeric, text) TO authenticated, service_role;
