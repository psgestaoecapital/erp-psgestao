-- PDCA commerce/estoque (auditor_pdca_2 13/11) · item 3 (F2.3)
-- Movimentação de estoque passa a PERSISTIR lote e validade.
-- A tela (commerce/estoque, modal de movimentação) já coleta Lote e Validade
-- e os envia para a função movimentar(), mas registrar_movimento_estoque não
-- aceitava esses parâmetros — o dado era silenciosamente descartado e as
-- colunas lote/validade de erp_estoque_movimentacoes ficavam sempre nulas,
-- mesmo com a coluna exibida na aba Movimentações.
--
-- FIX (aditivo, retrocompatível): acrescenta p_lote e p_validade ao FINAL da
-- assinatura (DEFAULT NULL — chamadas antigas continuam válidas) e grava nas
-- colunas já existentes. Nenhuma outra lógica muda.
-- RD-38: provado em BEGIN..ROLLBACK (persiste quando informado; NULL quando
-- omitido; chamada legada sem os parâmetros continua funcionando).
--
-- Observação: acrescentar parâmetros com DEFAULT cria uma SOBRECARGA (a
-- identidade da função é pela lista de tipos de argumento), não substitui a
-- original — o que tornaria chamadas posicionais ambíguas. Por isso removemos
-- primeiro a assinatura antiga (12 args) e recriamos com 14. As chamadas do
-- front são por parâmetro nomeado, então resolvem para a nova função.

DROP FUNCTION IF EXISTS public.registrar_movimento_estoque(
  uuid, uuid, character varying, numeric, numeric, character varying,
  character varying, uuid, character varying, text, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.registrar_movimento_estoque(
  p_company_id uuid,
  p_produto_id uuid,
  p_tipo character varying,
  p_quantidade numeric,
  p_custo_unitario numeric DEFAULT 0,
  p_motivo character varying DEFAULT NULL::character varying,
  p_ref_tipo character varying DEFAULT NULL::character varying,
  p_ref_id uuid DEFAULT NULL::uuid,
  p_ref_numero character varying DEFAULT NULL::character varying,
  p_observacoes text DEFAULT NULL::text,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_local_id uuid DEFAULT NULL::uuid,
  p_lote character varying DEFAULT NULL::character varying,
  p_validade date DEFAULT NULL::date
)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_mov_id UUID;
  v_estoque_atual DECIMAL;
  v_novo_estoque DECIMAL;
  v_custo_medio DECIMAL;
  v_valor_total DECIMAL;
  v_delta DECIMAL;
  v_tipo_persistido VARCHAR;
BEGIN
  SELECT estoque_atual, COALESCE(preco_custo_medio, preco_custo, 0)
  INTO v_estoque_atual, v_custo_medio
  FROM erp_produtos WHERE id = p_produto_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Produto nao encontrado'; END IF;

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

  -- FIX-RPC-MOVIMENTO-TIPO-PERSISTIDO-v1
  -- 'ajuste' (entrada assinada do fechar_inventario) nao existe no CHECK ·
  -- materializar em ajuste_positivo / ajuste_negativo pelo sinal do delta.
  -- delta=0 ja nao chega aqui (fechar_inventario filtra diferenca != 0).
  v_tipo_persistido := CASE
    WHEN p_tipo = 'ajuste' AND v_delta > 0 THEN 'ajuste_positivo'
    WHEN p_tipo = 'ajuste' AND v_delta < 0 THEN 'ajuste_negativo'
    ELSE p_tipo
  END;

  v_novo_estoque := COALESCE(v_estoque_atual, 0) + v_delta;
  v_valor_total := ABS(v_delta) * COALESCE(p_custo_unitario, v_custo_medio, 0);

  INSERT INTO erp_estoque_movimentacoes (
    company_id, produto_id, local_id, tipo, motivo,
    quantidade, quantidade_antes, quantidade_depois,
    custo_unitario, valor_total,
    ref_tipo, ref_id, ref_numero, observacoes, usuario_id,
    lote, validade
  ) VALUES (
    p_company_id, p_produto_id, p_local_id, v_tipo_persistido, p_motivo,
    ABS(p_quantidade), COALESCE(v_estoque_atual, 0), v_novo_estoque,
    COALESCE(p_custo_unitario, v_custo_medio, 0), v_valor_total,
    p_ref_tipo, p_ref_id, p_ref_numero, p_observacoes, p_usuario_id,
    NULLIF(TRIM(COALESCE(p_lote, '')), ''), p_validade
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
