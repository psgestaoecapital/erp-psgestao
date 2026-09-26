-- Chamado #122 (R.R · Rodrigo) · Grupo 1 — "Kanban não está efetivo: ao arrastar o orçamento e confirmar a
-- conversão em pedido, não passa para o próximo campo". E na conversa (24/09): "Somente deixa converter em pedido
-- após marcar como orçamento enviado; este processo pode ser extinguido, não precisa esse passo a passo."
-- Causa (provada na demo Comércio GE, ORC-2026-0009 em rascunho): a tela oferece "Converter em Pedido" em qualquer
-- etapa, mas fn_converter_orcamento_em_pedido só aceitava aprovado/visualizado/enviado → erro "Orcamento nao esta em
-- status convertivel (status atual: rascunho)" e o card não anda.
-- Correção: converter a partir de QUALQUER etapa aberta (rascunho, enviado, visualizado, aprovado). "Enviado" passa a
-- ser opcional. Recusado/expirado/cancelado/convertido/venda_avulsa continuam bloqueados.
-- Segurança (achado no caminho): a função é SECURITY DEFINER e não conferia a empresa do usuário e o anon podia
-- executá-la. Agora exige que o orçamento seja de uma empresa do usuário (ou admin/service_role/chamada interna) e o
-- anon perde o EXECUTE. Resto do corpo inalterado (carrega obra/itens, histórico).
CREATE OR REPLACE FUNCTION public.fn_converter_orcamento_em_pedido(p_orcamento_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_id uuid;
  v_orc record;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_orc IS NULL THEN
    RAISE EXCEPTION 'Orcamento % nao encontrado', p_orcamento_id;
  END IF;
  IF NOT (v_interno OR auth.role() = 'service_role' OR v_orc.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  -- #122: qualquer etapa aberta converte ("enviado" é opcional)
  IF v_orc.status NOT IN ('rascunho', 'enviado', 'visualizado', 'aprovado') THEN
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
    observacoes, observacoes_internas,
    obra_id, obra_cno, obra_logradouro, obra_numero, obra_complemento,
    obra_bairro, obra_cidade, obra_uf, obra_cep, obra_codigo_ibge,
    created_by
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
    v_orc.observacoes, v_orc.observacoes_internas,
    v_orc.obra_id, v_orc.obra_cno, v_orc.obra_logradouro, v_orc.obra_numero, v_orc.obra_complemento,
    v_orc.obra_bairro, v_orc.obra_cidade, v_orc.obra_uf, v_orc.obra_cep, v_orc.obra_codigo_ibge,
    auth.uid()
  )
  RETURNING id INTO v_pedido_id;

  INSERT INTO erp_pedidos_itens (
    pedido_id, company_id, ordem,
    tipo_item, servico_id, servico_codigo, servico_descricao,
    produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  )
  SELECT
    v_pedido_id, company_id, ordem,
    COALESCE(tipo_item, 'produto'), servico_id, servico_codigo, servico_descricao,
    produto_id, produto_codigo,
    produto_nome, produto_descricao, unidade, quantidade,
    preco_unitario, preco_custo, desconto_percentual, desconto_valor,
    subtotal, margem_percentual, observacoes
  FROM erp_orcamentos_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem ASC NULLS LAST;

  UPDATE erp_orcamentos
  SET status = 'convertido', pedido_id = v_pedido_id,
      convertido_em = NOW(), updated_at = NOW()
  WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (
    orcamento_id, company_id, evento, detalhe, usuario_id, metadata
  ) VALUES (
    p_orcamento_id, v_orc.company_id, 'convertido_pedido',
    'Convertido no pedido ' || v_pedido_id::text, auth.uid(),
    jsonb_build_object('pedido_id', v_pedido_id, 'status_origem', v_orc.status)
  );

  RETURN v_pedido_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_converter_orcamento_em_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_converter_orcamento_em_pedido(uuid) TO authenticated, service_role;
