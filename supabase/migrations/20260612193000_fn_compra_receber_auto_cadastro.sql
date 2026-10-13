-- =============================================================
-- FEAT-COMPRA-RECEBER-AUTO-CADASTRO-v1 · fn_compra_receber
-- =============================================================
-- Estende fn_compra_receber com AUTO-CADASTRO de produto livre.
--
-- Quando o item de compra nao tem produto_id (texto livre):
--   1) Reaproveita produto existente por codigo + company_id
--      (anti-duplicata · usa btrim · ignora vazio)
--   2) Senao, cria erp_produtos novo:
--      - nome = produto_nome || produto_codigo || fallback
--      - codigo = produto_codigo || 'AUTO-<8chars>'
--      - unidade = produto_unidade || 'UN'
--      - tipo='produto', preco_custo = preco_custo_medio = preco_unitario,
--        estoque_atual=0, ativo=true
--   3) Vincula via UPDATE erp_compras_itens.produto_id
--   4) Skip se nao houver nome NEM codigo (nada identificavel)
--
-- Resto do fluxo intocado: movimentacao 'entrada' · custo medio
-- ponderado · estoque atualizado · compra marcada estoque_baixado +
-- status 'recebida_total' + data_recebimento. Resposta agora inclui
-- produtos_criados.
--
-- Migration aplicada via MCP em 2026-06-12.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_compra_receber(p_compra_id uuid, p_local_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_compra record; v_local_id uuid; v_item record; v_pid uuid;
  v_qtd_antes numeric; v_custo_atual numeric; v_novo_custo numeric;
  v_movimentos jsonb := '[]'::jsonb; v_qtd_total int := 0; v_criados int := 0;
BEGIN
  SELECT * INTO v_compra FROM erp_compras WHERE id = p_compra_id;
  IF v_compra IS NULL THEN RAISE EXCEPTION 'Compra nao encontrada'; END IF;
  IF COALESCE(v_compra.estoque_baixado, false) THEN RAISE EXCEPTION 'Compra ja recebida'; END IF;

  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id FROM erp_estoque_locais
    WHERE company_id = v_compra.company_id AND COALESCE(principal,false)=true AND COALESCE(ativo,true)=true LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_compra.company_id, 'Estoque Principal', true, true) RETURNING id INTO v_local_id;
  END IF;

  FOR v_item IN
    SELECT id, produto_id, produto_nome, produto_codigo, unidade,
           COALESCE(quantidade,0)::numeric AS quantidade,
           COALESCE(preco_unitario,0)::numeric AS preco_unitario
    FROM erp_compras_itens WHERE compra_id = p_compra_id ORDER BY ordem NULLS LAST, id
  LOOP
    v_pid := v_item.produto_id;

    -- AUTO-CADASTRO no recebimento: item livre vira produto
    IF v_pid IS NULL THEN
      IF NULLIF(btrim(v_item.produto_codigo),'') IS NOT NULL THEN
        SELECT id INTO v_pid FROM erp_produtos
         WHERE company_id = v_compra.company_id AND codigo = btrim(v_item.produto_codigo) LIMIT 1;
      END IF;
      IF v_pid IS NULL THEN
        IF COALESCE(NULLIF(btrim(v_item.produto_nome),''), NULLIF(btrim(v_item.produto_codigo),'')) IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO erp_produtos (company_id, nome, codigo, unidade, tipo,
                                  preco_custo, preco_custo_medio, estoque_atual, ativo)
        VALUES (
          v_compra.company_id,
          COALESCE(NULLIF(btrim(v_item.produto_nome),''), v_item.produto_codigo, 'Produto sem nome'),
          COALESCE(NULLIF(btrim(v_item.produto_codigo),''), 'AUTO-'||upper(substring(v_item.id::text,1,8))),
          COALESCE(NULLIF(btrim(v_item.unidade),''), 'UN'),
          'produto', v_item.preco_unitario, v_item.preco_unitario, 0, true
        ) RETURNING id INTO v_pid;
        v_criados := v_criados + 1;
      END IF;
      UPDATE erp_compras_itens SET produto_id = v_pid, updated_at = now() WHERE id = v_item.id;
    END IF;

    IF v_item.quantidade <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
      INTO v_qtd_antes, v_custo_atual FROM erp_produtos WHERE id = v_pid;

    INSERT INTO erp_estoque_movimentacoes (
      company_id, produto_id, local_id, tipo, motivo,
      quantidade, quantidade_antes, quantidade_depois,
      custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, data_movimento
    ) VALUES (
      v_compra.company_id, v_pid, v_local_id, 'entrada', 'Compra ' || COALESCE(v_compra.numero,''),
      v_item.quantidade, v_qtd_antes, v_qtd_antes + v_item.quantidade,
      v_item.preco_unitario, v_item.quantidade * v_item.preco_unitario,
      'compra', v_compra.id, v_compra.numero, now()
    );

    v_novo_custo := CASE
      WHEN v_qtd_antes <= 0 THEN v_item.preco_unitario
      ELSE (v_qtd_antes * COALESCE(v_custo_atual,0) + v_item.quantidade * v_item.preco_unitario)
           / (v_qtd_antes + v_item.quantidade) END;

    UPDATE erp_produtos SET estoque_atual = v_qtd_antes + v_item.quantidade,
           preco_custo_medio = v_novo_custo, updated_at = now() WHERE id = v_pid;
    UPDATE erp_compras_itens SET quantidade_recebida = v_item.quantidade, updated_at = now() WHERE id = v_item.id;

    v_movimentos := v_movimentos || jsonb_build_object(
      'produto_id', v_pid, 'produto_nome', v_item.produto_nome, 'quantidade', v_item.quantidade,
      'qtd_antes', v_qtd_antes, 'qtd_depois', v_qtd_antes + v_item.quantidade, 'custo_novo', v_novo_custo);
    v_qtd_total := v_qtd_total + 1;
  END LOOP;

  UPDATE erp_compras SET estoque_baixado = true, status = 'recebida_total',
         data_recebimento = CURRENT_DATE, updated_at = now() WHERE id = p_compra_id;

  RETURN jsonb_build_object('ok', true, 'compra_id', p_compra_id, 'local_id', v_local_id,
    'qtd_itens', v_qtd_total, 'produtos_criados', v_criados, 'movimentos', v_movimentos);
END;
$function$;
