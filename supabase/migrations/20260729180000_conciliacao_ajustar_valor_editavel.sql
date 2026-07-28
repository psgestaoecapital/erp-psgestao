-- CONCILIAÇÃO · valor do título editável no ajuste (conta recorrente com valor variável — energia/água/telefone).
-- Necessidade (CEO): título programado R$100 (estimativa), fatura real R$137. NÃO é juros — é correção do
-- valor real do título. fn_conciliacao_ajustar_valores ganha p_valor_novo: atualiza erp_*.valor + registra a
-- mudança de→para na observação (RD-38, alterar valor é sensível). O recompute (soma vs líquido =
-- valor+juros−desconto) já recalcula o status com o novo valor — base já suporta.
--
-- Também: a RPC deixa de mexer em valor_pago (o dono do valor_pago é o recompute / registrar_pagamento).
-- Isso torna seguro editar o valor tanto no caminho "quita" quanto no "deixar em aberto" (parcial), sem
-- risco de dupla-baixa. RD-52: uma fonte de verdade para o valor_pago.

-- overload novo (6 args): dropa a versão de 5 args para não deixar duas verdades.
DROP FUNCTION IF EXISTS public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_ajustar_valores(
  p_lancamento_id uuid, p_tipo text, p_valor_juros numeric DEFAULT 0,
  p_valor_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text,
  p_valor_novo numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_valor_atual numeric; v_valor_final numeric; v_company uuid; v_obs text := '';
BEGIN
  IF p_tipo = 'receber' THEN
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_receber WHERE id = p_lancamento_id;
  ELSE
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_pagar WHERE id = p_lancamento_id;
  END IF;
  IF v_valor_atual IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  -- alterar valor/baixa é sensível: guard de empresa (RD-38)
  IF NOT (v_company IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  v_valor_final := COALESCE(p_valor_novo, v_valor_atual);
  IF p_valor_novo IS NOT NULL AND round(p_valor_novo, 2) <> round(v_valor_atual, 2) THEN
    v_obs := v_obs || ' [VALOR AJUSTADO: R$' || to_char(v_valor_atual, 'FM999999990.00')
                   || ' → R$' || to_char(v_valor_final, 'FM999999990.00') || ' na conciliação]';
  END IF;
  IF p_observacao IS NOT NULL AND btrim(p_observacao) <> '' THEN
    v_obs := v_obs || ' [AJUSTE: ' || p_observacao || ']';
  END IF;

  IF p_tipo = 'receber' THEN
    UPDATE erp_receber SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_pagar SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true,
    'valor_original', v_valor_atual, 'valor_novo', v_valor_final,
    'valor_ajustado', round(v_valor_final + COALESCE(p_valor_juros,0) - COALESCE(p_valor_desconto,0), 2),
    'juros', COALESCE(p_valor_juros,0), 'desconto', COALESCE(p_valor_desconto,0));
END $function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_ajustar_valores(uuid, text, numeric, numeric, text, numeric) TO authenticated;
