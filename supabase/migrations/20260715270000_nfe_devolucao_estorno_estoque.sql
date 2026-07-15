-- FISCAL/ESTOQUE · Devolução NF → estorna estoque · RD-53
-- ============================================================================
-- Gap achado na auditoria KGF: a NF de devolução (compra E venda) EMITE e vincula à NF
-- original (chave_referenciada), mas NÃO movimenta o estoque de volta. A base já existe:
-- erp_estoque_movimentacoes tem os tipos 'devolucao_saida'/'devolucao_entrada' e
-- fn_movimentar_estoque faz o movimento. Falta só ACOPLAR o estorno à emissão.
--
--   Devolução de COMPRA (devolve peça pro FORNECEDOR) → estoque SAI ('devolucao_saida', −1).
--   Devolução de VENDA  (cliente devolve a peça)      → estoque ENTRA ('devolucao_entrada', +1).
--
-- Idempotência: 1 estorno por NF de devolução (guarda via ref_tipo='nfe_devolucao'+ref_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_nfe_devolucao_estornar_estoque(
  p_company_id uuid, p_nfe_emitida_id uuid, p_itens jsonb, p_direcao text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_tipo text; v_local uuid; v_numero text; v_item jsonb; v_movidos int := 0; v_mov uuid;
BEGIN
  -- direção → tipo de movimento
  v_tipo := CASE p_direcao WHEN 'compra' THEN 'devolucao_saida'
                           WHEN 'venda'  THEN 'devolucao_entrada' END;
  IF v_tipo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;

  -- IDEMPOTÊNCIA: se já estornou esta NF de devolução, não repete
  IF EXISTS (SELECT 1 FROM erp_estoque_movimentacoes
             WHERE company_id = p_company_id AND ref_tipo = 'nfe_devolucao' AND ref_id = p_nfe_emitida_id) THEN
    RETURN jsonb_build_object('ok', true, 'ja_estornado', true, 'movidos', 0);
  END IF;

  -- local de estoque da empresa (primeiro disponível)
  SELECT id INTO v_local FROM erp_estoque_locais WHERE company_id = p_company_id ORDER BY id LIMIT 1;
  IF v_local IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_local_estoque'); END IF;

  SELECT numero INTO v_numero FROM erp_nfe_emitidas WHERE id = p_nfe_emitida_id;

  -- estorna item a item (fn_movimentar_estoque valida estoque não-negativo)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF (v_item->>'produto_id') IS NULL OR (v_item->>'quantidade') IS NULL THEN CONTINUE; END IF;
    v_mov := fn_movimentar_estoque(
      (v_item->>'produto_id')::uuid, v_local, v_tipo, (v_item->>'quantidade')::numeric,
      COALESCE((v_item->>'custo')::numeric, 0),
      'Devolução de ' || p_direcao, 'NF de devolução ' || COALESCE(v_numero, ''),
      'nfe_devolucao', p_nfe_emitida_id, v_numero);
    v_movidos := v_movidos + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ja_estornado', false, 'movidos', v_movidos, 'tipo', v_tipo);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_nfe_devolucao_estornar_estoque(uuid, uuid, jsonb, text) TO authenticated, service_role;
