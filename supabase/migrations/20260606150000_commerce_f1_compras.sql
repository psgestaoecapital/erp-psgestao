-- =============================================================
-- COMMERCE-F1 · fn_compra_receber + fn_compra_gerar_titulos
-- =============================================================
-- Ciclo Comercio Fase 1:
--   COMPRA -> ENTRADA estoque (custo medio ponderado) -> CONTAS A PAGAR
-- Idempotente · transacional · usa enums reais:
--   erp_compras.status: aberta|aguardando_entrega|recebida_parcial|
--                       recebida_total|finalizada|cancelada
--   erp_estoque_movimentacoes.tipo='entrada' · ref_tipo='compra'
-- =============================================================

-- 1. fn_compra_receber
CREATE OR REPLACE FUNCTION public.fn_compra_receber(
  p_compra_id uuid,
  p_local_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra record;
  v_local_id uuid;
  v_item record;
  v_qtd_antes numeric;
  v_custo_atual numeric;
  v_novo_custo numeric;
  v_movimentos jsonb := '[]'::jsonb;
  v_qtd_total int := 0;
BEGIN
  SELECT * INTO v_compra FROM erp_compras WHERE id = p_compra_id;
  IF v_compra IS NULL THEN
    RAISE EXCEPTION 'Compra nao encontrada';
  END IF;
  IF COALESCE(v_compra.estoque_baixado, false) THEN
    RAISE EXCEPTION 'Compra ja recebida';
  END IF;

  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id
    FROM erp_estoque_locais
    WHERE company_id = v_compra.company_id
      AND COALESCE(principal, false) = true
      AND COALESCE(ativo, true) = true
    LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_compra.company_id, 'Estoque Principal', true, true)
    RETURNING id INTO v_local_id;
  END IF;

  FOR v_item IN
    SELECT id, produto_id, produto_nome, produto_codigo, unidade,
           COALESCE(quantidade, 0)::numeric AS quantidade,
           COALESCE(preco_unitario, 0)::numeric AS preco_unitario
    FROM erp_compras_itens
    WHERE compra_id = p_compra_id
    ORDER BY ordem NULLS LAST, id
  LOOP
    IF v_item.produto_id IS NULL THEN CONTINUE; END IF;
    IF v_item.quantidade <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(estoque_atual, 0), COALESCE(preco_custo_medio, preco_custo, 0)
      INTO v_qtd_antes, v_custo_atual
    FROM erp_produtos WHERE id = v_item.produto_id;

    INSERT INTO erp_estoque_movimentacoes (
      company_id, produto_id, local_id, tipo, motivo,
      quantidade, quantidade_antes, quantidade_depois,
      custo_unitario, valor_total,
      ref_tipo, ref_id, ref_numero,
      data_movimento
    ) VALUES (
      v_compra.company_id, v_item.produto_id, v_local_id, 'entrada',
      'Compra ' || COALESCE(v_compra.numero, ''),
      v_item.quantidade, v_qtd_antes, v_qtd_antes + v_item.quantidade,
      v_item.preco_unitario, v_item.quantidade * v_item.preco_unitario,
      'compra', v_compra.id, v_compra.numero,
      now()
    );

    v_novo_custo := CASE
      WHEN v_qtd_antes <= 0 THEN v_item.preco_unitario
      ELSE (v_qtd_antes * COALESCE(v_custo_atual, 0) + v_item.quantidade * v_item.preco_unitario)
           / (v_qtd_antes + v_item.quantidade)
    END;

    UPDATE erp_produtos
       SET estoque_atual = v_qtd_antes + v_item.quantidade,
           preco_custo_medio = v_novo_custo,
           updated_at = now()
     WHERE id = v_item.produto_id;

    UPDATE erp_compras_itens
       SET quantidade_recebida = v_item.quantidade,
           updated_at = now()
     WHERE id = v_item.id;

    v_movimentos := v_movimentos || jsonb_build_object(
      'produto_id', v_item.produto_id,
      'produto_nome', v_item.produto_nome,
      'quantidade', v_item.quantidade,
      'qtd_antes', v_qtd_antes,
      'qtd_depois', v_qtd_antes + v_item.quantidade,
      'custo_novo', v_novo_custo
    );
    v_qtd_total := v_qtd_total + 1;
  END LOOP;

  UPDATE erp_compras
     SET estoque_baixado = true,
         status = 'recebida_total',
         data_recebimento = CURRENT_DATE,
         updated_at = now()
   WHERE id = p_compra_id;

  RETURN jsonb_build_object(
    'ok', true,
    'compra_id', p_compra_id,
    'local_id', v_local_id,
    'qtd_itens', v_qtd_total,
    'movimentos', v_movimentos
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_compra_receber(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_compra_receber(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_compra_receber IS
  'COMMERCE-F1 · Recebe compra: insere movimentacoes entrada, atualiza estoque_atual + custo medio ponderado, marca status=recebida_total. Idempotente via erp_compras.estoque_baixado.';


-- 2. fn_compra_gerar_titulos
CREATE OR REPLACE FUNCTION public.fn_compra_gerar_titulos(
  p_compra_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra record;
  v_n int;
  v_valor_parcela numeric;
  v_data_venc date;
  i int;
  v_valor_atual numeric;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  SELECT * INTO v_compra FROM erp_compras WHERE id = p_compra_id;
  IF v_compra IS NULL THEN
    RAISE EXCEPTION 'Compra nao encontrada';
  END IF;
  IF COALESCE(v_compra.titulos_gerados, false) THEN
    RAISE EXCEPTION 'Titulos ja gerados pra esta compra';
  END IF;
  IF COALESCE(v_compra.total, 0) <= 0 THEN
    RAISE EXCEPTION 'Compra sem valor total';
  END IF;

  v_n := COALESCE(NULLIF(v_compra.parcelas, 0), 1);
  v_data_venc := COALESCE(v_compra.primeiro_vencimento, CURRENT_DATE);
  v_valor_parcela := ROUND(v_compra.total / v_n, 2);

  FOR i IN 1..v_n LOOP
    v_valor_atual := CASE
      WHEN i = v_n THEN v_compra.total - (v_valor_parcela * (v_n - 1))
      ELSE v_valor_parcela
    END;

    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome,
      descricao, categoria,
      valor, data_emissao, data_vencimento, status,
      forma_pagamento,
      numero_documento, numero_nf,
      parcela,
      created_at
    ) VALUES (
      v_compra.company_id,
      v_compra.fornecedor_id,
      v_compra.fornecedor_nome,
      'Compra ' || COALESCE(v_compra.numero, ''),
      'Compras de mercadorias',
      v_valor_atual,
      COALESCE(v_compra.data_pedido, CURRENT_DATE),
      (v_data_venc + ((i - 1) * INTERVAL '1 month'))::date,
      'aberto',
      v_compra.forma_pagamento,
      v_compra.numero,
      v_compra.nf_numero,
      CASE WHEN v_n > 1 THEN i || '/' || v_n ELSE NULL END,
      now()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE erp_compras
     SET titulos_gerados = true,
         updated_at = now()
   WHERE id = p_compra_id;

  RETURN jsonb_build_object(
    'ok', true,
    'compra_id', p_compra_id,
    'qtd_parcelas', v_n,
    'valor_total', v_compra.total,
    'ids', to_jsonb(v_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_compra_gerar_titulos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_compra_gerar_titulos(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_compra_gerar_titulos IS
  'COMMERCE-F1 · Gera erp_pagar (status=aberto) pra cada parcela da compra. Vencimento mensal a partir de primeiro_vencimento. Ultima parcela absorve resto de arredondamento. Idempotente via erp_compras.titulos_gerados.';
