-- ELO aceite→Pedido (orçamento público aprovado → Pedido) · hardening idempotente do converter
-- ============================================================================
-- O aceite público (/api/orcamento-publico/[hash] POST 'aprovar') passa a gerar o Pedido
-- REUSANDO o converter existente converter_orcamento_pedido (RD-26 — não recria). Para o
-- duplo-clique nunca criar 2 Pedidos, o converter ganha a guarda pedido_id IS NULL (além do
-- status='convertido' que já existia). Resto do corpo idêntico (numeração next_pedido_numero).
--
-- Prova RD-53 (Tryo · rollback-safe, nada persistido): pedidos 0→1 (exatamente +1) · duplo-clique
-- BLOQUEADO (não cria 2º) · pedido.company_id = orcamento.company_id (Pilar 2, sem vazamento).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.converter_orcamento_pedido(p_orcamento_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pedido_id UUID;
  v_orc RECORD;
  v_numero VARCHAR;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orcamento nao encontrado'; END IF;
  IF v_orc.status = 'convertido' THEN RAISE EXCEPTION 'Orcamento ja foi convertido'; END IF;
  -- idempotencia (duplo-clique): nunca cria 2o Pedido pro mesmo orcamento
  IF v_orc.pedido_id IS NOT NULL THEN RAISE EXCEPTION 'Orcamento ja convertido (pedido %)', v_orc.pedido_id; END IF;

  v_numero := next_pedido_numero(v_orc.company_id);

  INSERT INTO erp_pedidos (
    company_id, numero, orcamento_origem_id,
    cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    data_pedido, data_prevista_entrega,
    status, vendedor_id, vendedor_nome, comissao_percentual,
    condicao_pagamento, forma_pagamento, prazo_entrega_dias,
    frete_tipo, frete_valor,
    subtotal, desconto_percentual, desconto_valor, acrescimo_valor, total,
    observacoes, created_by
  ) VALUES (
    v_orc.company_id, v_numero, v_orc.id,
    v_orc.cliente_id, v_orc.cliente_nome, v_orc.cliente_cnpj, v_orc.cliente_email, v_orc.cliente_telefone,
    CURRENT_DATE, CURRENT_DATE + COALESCE(v_orc.prazo_entrega_dias, 0),
    'aberto', v_orc.vendedor_id, v_orc.vendedor_nome, v_orc.comissao_percentual,
    v_orc.condicao_pagamento, v_orc.forma_pagamento, v_orc.prazo_entrega_dias,
    v_orc.frete_tipo, v_orc.frete_valor,
    v_orc.subtotal, v_orc.desconto_percentual, v_orc.desconto_valor, v_orc.acrescimo_valor, v_orc.total,
    v_orc.observacoes, p_user_id
  ) RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem,
    tipo_item, produto_id, produto_codigo, produto_nome, produto_descricao,
    servico_id, servico_codigo, servico_descricao,
    unidade, quantidade, preco_unitario, preco_custo,
    desconto_percentual, desconto_valor, subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens WHERE orcamento_id = p_orcamento_id ORDER BY ordem;

  UPDATE erp_orcamentos SET
    status = 'convertido',
    pedido_id = v_pedido_id,
    convertido_em = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id)
  VALUES (p_orcamento_id, v_orc.company_id, 'convertido_pedido', 'Convertido em pedido ' || v_numero, p_user_id);

  RETURN v_pedido_id;
END; $function$;
