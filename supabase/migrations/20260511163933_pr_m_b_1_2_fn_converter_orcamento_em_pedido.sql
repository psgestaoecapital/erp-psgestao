-- PR M.B.1.2: Conversao Orcamento → Pedido (OTC)
-- Copia orcamento + itens para pedido com prefixo PED- no numero
-- e marca orcamento como 'convertido' com link bidirecional.

CREATE OR REPLACE FUNCTION public.fn_converter_orcamento_em_pedido(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
  v_orc record;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_orc IS NULL THEN
    RAISE EXCEPTION 'Orcamento % nao encontrado', p_orcamento_id;
  END IF;
  IF v_orc.status NOT IN ('aprovado', 'visualizado', 'enviado') THEN
    RAISE EXCEPTION 'Orcamento nao esta em status convertivel (status atual: %)', v_orc.status;
  END IF;
  IF v_orc.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Orcamento ja foi convertido em pedido %', v_orc.pedido_id;
  END IF;

  INSERT INTO erp_pedidos (
    company_id, numero, orcamento_origem_id, cliente_id, cliente_nome,
    cliente_cnpj, cliente_email, cliente_telefone, data_pedido, status,
    vendedor_id, vendedor_nome, comissao_percentual,
    condicao_pagamento, forma_pagamento, prazo_entrega_dias,
    frete_tipo, frete_valor,
    subtotal, desconto_percentual, desconto_valor, acrescimo_valor, total,
    observacoes, observacoes_internas, created_by
  )
  VALUES (
    v_orc.company_id,
    'PED-' || COALESCE(v_orc.numero, p_orcamento_id::text),
    v_orc.id,
    v_orc.cliente_id, v_orc.cliente_nome, v_orc.cliente_cnpj,
    v_orc.cliente_email, v_orc.cliente_telefone, CURRENT_DATE, 'aberto',
    v_orc.vendedor_id, v_orc.vendedor_nome, v_orc.comissao_percentual,
    v_orc.condicao_pagamento, v_orc.forma_pagamento, v_orc.prazo_entrega_dias,
    v_orc.frete_tipo, v_orc.frete_valor,
    v_orc.subtotal, v_orc.desconto_percentual, v_orc.desconto_valor,
    v_orc.acrescimo_valor, v_orc.total,
    v_orc.observacoes, v_orc.observacoes_internas, auth.uid()
  )
  RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem, produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem, produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem ASC NULLS LAST;

  UPDATE erp_orcamentos
  SET status = 'convertido',
      pedido_id = v_pedido_id,
      convertido_em = NOW(),
      updated_at = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (
    orcamento_id, company_id, evento, detalhe, usuario_id, metadata
  ) VALUES (
    p_orcamento_id, v_orc.company_id,
    'convertido_pedido',
    'Convertido no pedido ' || v_pedido_id::text,
    auth.uid(),
    jsonb_build_object('pedido_id', v_pedido_id)
  );

  RETURN v_pedido_id;
END $$;

COMMENT ON FUNCTION public.fn_converter_orcamento_em_pedido IS
'M.B.1.2 OTC: converte orcamento aprovado em pedido. Copia cabecalho + itens, atualiza orcamento para status=convertido, registra historico.';
