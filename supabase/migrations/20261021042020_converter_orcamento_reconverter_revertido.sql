-- Chamado #3858 (FCR · jordana-code): orçamento revertido de pedido não convertia de novo.
-- fn_pedido_reverter_para_orcamento deixa o pedido 'revertido' com o número 'PED-' || orc.numero; a reconversão
-- tentava inserir outro pedido com o MESMO número e violava erp_pedidos_company_id_numero_key (company_id, numero).
-- Correção (só nesta função; o resto é a definição viva lida por pg_get_functiondef em 20/10):
--   1) trava o orçamento (FOR UPDATE) e recusa, com mensagem simples, se já existir pedido ATIVO do orçamento
--      (status fora de 'revertido'/'cancelado') — nunca 2 pedidos ativos do mesmo orçamento;
--   2) número livre: 'PED-' || numero; se já usado na empresa,
--      sufixo -2, -3, ... (PED-ORC-2026-0002-2), cortando a base para caber no varchar(20);
--   3) mensagens de erro em linguagem do usuário (a tela mostra o texto da exceção).
-- O pedido 'revertido' fica como histórico (não é reaproveitado): os itens do pedido novo saem do orçamento atual.

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
  v_base text;
  v_numero text;
  v_sufixo text;
  v_n int := 1;
  v_ativo text;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF v_orc IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;
  IF NOT (v_interno OR auth.role() = 'service_role' OR v_orc.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  -- #122: qualquer etapa aberta converte ("enviado" é opcional)
  IF v_orc.status NOT IN ('rascunho', 'enviado', 'visualizado', 'aprovado') THEN
    RAISE EXCEPTION 'Este orçamento não pode virar pedido na situação atual (%).', v_orc.status;
  END IF;
  IF v_orc.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este orçamento já foi convertido em pedido.';
  END IF;

  -- #3858: nunca 2 pedidos ativos do mesmo orçamento (revertido/cancelado saíram do fluxo)
  SELECT numero INTO v_ativo FROM erp_pedidos
   WHERE orcamento_origem_id = p_orcamento_id
     AND status NOT IN ('revertido', 'cancelado')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Este orçamento já tem o pedido % em andamento.', COALESCE(v_ativo, '');
  END IF;

  -- #3858: número livre na empresa (o pedido revertido guarda o número original)
  v_base := 'PED-' || COALESCE(v_orc.numero, p_orcamento_id::text);
  v_numero := left(v_base, 20);
  WHILE EXISTS (SELECT 1 FROM erp_pedidos WHERE company_id = v_orc.company_id AND numero = v_numero) LOOP
    v_n := v_n + 1;
    IF v_n > 99 THEN
      RAISE EXCEPTION 'Não foi possível gerar o número do pedido para este orçamento.';
    END IF;
    v_sufixo := '-' || v_n;
    v_numero := left(v_base, 20 - length(v_sufixo)) || v_sufixo;
  END LOOP;

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
    v_numero,
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
    'Convertido no pedido ' || v_numero, auth.uid(),
    jsonb_build_object('pedido_id', v_pedido_id, 'numero', v_numero, 'status_origem', v_orc.status)
  );

  RETURN v_pedido_id;
END $function$;

-- Mantém os mesmos privilégios de produção (authenticated + service_role; nunca anon).
REVOKE ALL ON FUNCTION public.fn_converter_orcamento_em_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_converter_orcamento_em_pedido(uuid) TO authenticated, service_role;
