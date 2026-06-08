-- =============================================================
-- FIX-RPC-MOVIMENTO-ESTOQUE-DELTA-v1 · Saneamento V1 Fase 1
-- =============================================================
-- Bug: registrar_movimento_estoque tinha CASE de v_delta que so
-- reconhecia 'ajuste' (assinado) · NAO conhecia 'ajuste_positivo'
-- nem 'ajuste_negativo' (nomes reais do CHECK e do front desde F2.2).
-- ELSE 0 silencioso engolia o erro · movimento gravava com depois=antes
-- + valor_total=0 · estoque_atual nao mudava.
--
-- Evidencia: ajuste +5 OLEO (mov 10258398) antes=10 depois=10 valor=0.
--
-- Fix:
-- 1) CASE reconhece 'ajuste_positivo' / 'ajuste_negativo' / 'compra' / 'venda'
-- 2) ELSE NULL + RAISE EXCEPTION 'Tipo de movimento nao reconhecido: %'
--    (acaba com no-op silencioso · Regra #34 integridade instrumental)
--
-- fechar_inventario continua usando 'ajuste' com quantidade assinada · OK.
-- Migration aplicada via MCP em 2026-06-07.
-- Movimento fantasma 10258398-fd8b-42d9-afee-c4861717c064 deletado
-- pra nao poluir leitura (estoque OLEO baseline = 10 mantido).
-- =============================================================

CREATE OR REPLACE FUNCTION public.registrar_movimento_estoque(
  p_company_id uuid, p_produto_id uuid, p_tipo character varying, p_quantidade numeric,
  p_custo_unitario numeric DEFAULT 0, p_motivo character varying DEFAULT NULL,
  p_ref_tipo character varying DEFAULT NULL, p_ref_id uuid DEFAULT NULL,
  p_ref_numero character varying DEFAULT NULL, p_observacoes text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL, p_local_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_mov_id UUID;
  v_estoque_atual DECIMAL;
  v_novo_estoque DECIMAL;
  v_custo_medio DECIMAL;
  v_valor_total DECIMAL;
  v_delta DECIMAL;
BEGIN
  SELECT estoque_atual, COALESCE(preco_custo_medio, preco_custo, 0)
  INTO v_estoque_atual, v_custo_medio
  FROM erp_produtos WHERE id = p_produto_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Produto nao encontrado'; END IF;

  -- FIX-RPC-MOVIMENTO-ESTOQUE-DELTA-v1
  v_delta := CASE
    WHEN p_tipo IN ('entrada','devolucao','inicial','compra') THEN ABS(p_quantidade)
    WHEN p_tipo IN ('saida','perda','venda')                  THEN -ABS(p_quantidade)
    WHEN p_tipo = 'ajuste_positivo'                           THEN ABS(p_quantidade)
    WHEN p_tipo = 'ajuste_negativo'                           THEN -ABS(p_quantidade)
    WHEN p_tipo = 'ajuste'                                    THEN p_quantidade
    WHEN p_tipo = 'transferencia'                             THEN -ABS(p_quantidade)
    ELSE NULL
  END;
  IF v_delta IS NULL THEN
    RAISE EXCEPTION 'Tipo de movimento nao reconhecido: %', p_tipo;
  END IF;

  v_novo_estoque := COALESCE(v_estoque_atual, 0) + v_delta;
  v_valor_total := ABS(v_delta) * COALESCE(p_custo_unitario, v_custo_medio, 0);

  INSERT INTO erp_estoque_movimentacoes (
    company_id, produto_id, local_id, tipo, motivo,
    quantidade, quantidade_antes, quantidade_depois,
    custo_unitario, valor_total,
    ref_tipo, ref_id, ref_numero, observacoes, usuario_id
  ) VALUES (
    p_company_id, p_produto_id, p_local_id, p_tipo, p_motivo,
    ABS(p_quantidade), COALESCE(v_estoque_atual, 0), v_novo_estoque,
    COALESCE(p_custo_unitario, v_custo_medio, 0), v_valor_total,
    p_ref_tipo, p_ref_id, p_ref_numero, p_observacoes, p_usuario_id
  ) RETURNING id INTO v_mov_id;

  UPDATE erp_produtos SET
    estoque_atual = v_novo_estoque,
    preco_custo_medio = CASE
      WHEN v_delta > 0 AND p_custo_unitario > 0 AND COALESCE(v_estoque_atual, 0) > 0 THEN
        ((COALESCE(v_estoque_atual, 0) * COALESCE(v_custo_medio, 0)) + (ABS(v_delta) * p_custo_unitario)) / v_novo_estoque
      WHEN v_delta > 0 AND p_custo_unitario > 0 THEN p_custo_unitario
      ELSE COALESCE(v_custo_medio, preco_custo_medio)
    END,
    updated_at = NOW()
  WHERE id = p_produto_id;

  RETURN v_mov_id;
END; $function$;

-- Cleanup movimento fantasma de teste (depois=antes · valor=0)
DELETE FROM public.erp_estoque_movimentacoes
WHERE id = '10258398-fd8b-42d9-afee-c4861717c064';
