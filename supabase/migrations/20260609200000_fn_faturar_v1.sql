-- =============================================================
-- FEAT-OS-ONDA3-FATURAR-v1 · Onda 3 da trilha OS
-- =============================================================
-- Faturamento do pedido em 1 RPC atomica:
--  1) Baixa de estoque (tipo='venda') pra cada produto + cada componente
--     da BOM dos itens de servico (erp_servicos_produtos)
--  2) CMV acumulado e gravado em erp_pedidos.cmv (nova coluna)
--  3) Titulos a receber: 1 por parcela (Onda 2) com numero_documento
--     "PED N/M" · fallback a vista se nao houver parcelas
--  4) Marca pedido com status='faturado', data_faturamento, titulos_gerados
--
-- Retorna jsonb com {ok, pedido_id, numero, cmv, qtd_movimentos_estoque,
--                    qtd_titulos_receber, receber_ids, movimentos[]}
--
-- Idempotencia: se pedido ja faturado (status OR titulos_gerados) -> RAISE.
-- Migration aplicada via MCP em 2026-06-09.
-- =============================================================

ALTER TABLE erp_pedidos ADD COLUMN IF NOT EXISTS cmv numeric(14,2);

CREATE OR REPLACE FUNCTION fn_faturar(p_pedido_id uuid, p_local_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ped record; v_local_id uuid; v_item record; v_bom record;
  v_qtd_antes numeric; v_custo numeric; v_qtd_baixa numeric;
  v_cmv numeric := 0; v_movs jsonb := '[]'::jsonb; v_n_mov int := 0;
  v_parc record; v_rec_ids uuid[] := ARRAY[]::uuid[]; v_rec_id uuid; v_n_parc int := 0;
  v_tot_parc int;
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  IF v_ped.status = 'faturado' OR COALESCE(v_ped.titulos_gerados,false) THEN
    RAISE EXCEPTION 'Pedido % ja foi faturado', v_ped.numero;
  END IF;
  IF v_ped.status = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado nao pode ser faturado'; END IF;

  -- local de estoque (igual fn_compra_receber)
  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id FROM erp_estoque_locais
    WHERE company_id = v_ped.company_id AND COALESCE(principal,false)=true AND COALESCE(ativo,true)=true LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_ped.company_id, 'Estoque Principal', true, true) RETURNING id INTO v_local_id;
  END IF;

  -- 1) BAIXA DE ESTOQUE (saida) + CMV
  FOR v_item IN
    SELECT tipo_item, produto_id, produto_nome, servico_id, servico_descricao,
           COALESCE(quantidade,0)::numeric AS quantidade
    FROM erp_pedidos_itens WHERE pedido_id = p_pedido_id ORDER BY ordem NULLS LAST, id
  LOOP
    IF v_item.tipo_item = 'produto' AND v_item.produto_id IS NOT NULL AND v_item.quantidade > 0 THEN
      SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
        INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_item.produto_id;
      INSERT INTO erp_estoque_movimentacoes (
        company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
        custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, data_movimento
      ) VALUES (
        v_ped.company_id, v_item.produto_id, v_local_id, 'venda',
        'Faturamento pedido ' || COALESCE(v_ped.numero,''),
        v_item.quantidade, v_qtd_antes, v_qtd_antes - v_item.quantidade,
        v_custo, v_item.quantidade * v_custo, 'pedido', v_ped.id, v_ped.numero, now()
      );
      UPDATE erp_produtos SET estoque_atual = v_qtd_antes - v_item.quantidade, updated_at = now()
        WHERE id = v_item.produto_id;
      v_cmv := v_cmv + v_item.quantidade * v_custo; v_n_mov := v_n_mov + 1;
      v_movs := v_movs || jsonb_build_object('origem','produto','produto_id',v_item.produto_id,'nome',v_item.produto_nome,'qtd',v_item.quantidade,'antes',v_qtd_antes,'depois',v_qtd_antes - v_item.quantidade,'custo',v_custo);

    ELSIF v_item.tipo_item = 'servico' AND v_item.servico_id IS NOT NULL THEN
      FOR v_bom IN
        SELECT produto_id, produto_nome, COALESCE(quantidade_padrao,1)::numeric AS qpad
        FROM erp_servicos_produtos WHERE servico_id = v_item.servico_id AND produto_id IS NOT NULL
      LOOP
        v_qtd_baixa := v_bom.qpad * v_item.quantidade;
        IF v_qtd_baixa <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
          INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_bom.produto_id;
        INSERT INTO erp_estoque_movimentacoes (
          company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
          custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, data_movimento
        ) VALUES (
          v_ped.company_id, v_bom.produto_id, v_local_id, 'venda',
          'Faturamento pedido ' || COALESCE(v_ped.numero,'') || ' (BOM ' || COALESCE(v_item.servico_descricao,'servico') || ')',
          v_qtd_baixa, v_qtd_antes, v_qtd_antes - v_qtd_baixa,
          v_custo, v_qtd_baixa * v_custo, 'pedido', v_ped.id, v_ped.numero, now()
        );
        UPDATE erp_produtos SET estoque_atual = v_qtd_antes - v_qtd_baixa, updated_at = now()
          WHERE id = v_bom.produto_id;
        v_cmv := v_cmv + v_qtd_baixa * v_custo; v_n_mov := v_n_mov + 1;
        v_movs := v_movs || jsonb_build_object('origem','bom_servico','servico_id',v_item.servico_id,'produto_id',v_bom.produto_id,'nome',v_bom.produto_nome,'qtd',v_qtd_baixa,'antes',v_qtd_antes,'depois',v_qtd_antes - v_qtd_baixa,'custo',v_custo);
      END LOOP;
    END IF;
  END LOOP;

  -- 2) A RECEBER: 1 titulo por parcela editavel (Onda 2); fallback a vista
  SELECT COUNT(*) INTO v_tot_parc FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;
  IF v_tot_parc > 0 THEN
    FOR v_parc IN SELECT numero, valor, vencimento, forma_pagamento
                  FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id ORDER BY numero
    LOOP
      INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
        valor, status, categoria, numero_documento, descricao, forma_pagamento, created_at)
      VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE, v_parc.vencimento,
        v_parc.valor, 'aberto', 'Receita de vendas',
        COALESCE(v_ped.numero,'') || ' ' || v_parc.numero || '/' || v_tot_parc,
        'Pedido ' || COALESCE(v_ped.numero,'') || ' - parcela ' || v_parc.numero || '/' || v_tot_parc,
        v_parc.forma_pagamento, now())
      RETURNING id INTO v_rec_id;
      v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := v_n_parc + 1;
    END LOOP;
  ELSE
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, created_at)
    VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE,
      COALESCE(v_ped.primeiro_vencimento, CURRENT_DATE), v_ped.total, 'aberto', 'Receita de vendas',
      v_ped.numero, 'Pedido ' || COALESCE(v_ped.numero,''), now())
    RETURNING id INTO v_rec_id;
    v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := 1;
  END IF;

  -- 3) marca pedido faturado
  UPDATE erp_pedidos SET status='faturado', data_faturamento=now(), titulos_gerados=true, cmv=v_cmv, updated_at=now()
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'numero',v_ped.numero,
    'cmv',v_cmv,'qtd_movimentos_estoque',v_n_mov,'qtd_titulos_receber',v_n_parc,
    'receber_ids',to_jsonb(v_rec_ids),'movimentos',v_movs);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_faturar(uuid, uuid) TO authenticated;
