-- =============================================================
-- FEAT-OS-ONDA4-O44-IMPRESSAO-v1 · Onda 4.4 da trilha OS (FECHA)
-- =============================================================
-- Impressao da OS (generico) · documento entregavel.
-- RPC read-only consolidada · 1 chamada do front -> empresa + os +
-- pedido + itens + parcelas pra layout A4 print-friendly.
--
-- SECURITY DEFINER · authenticated grant.
--
-- Migration aplicada via MCP em 2026-06-11.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_os_imprimir_dados(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_os  erp_os%ROWTYPE;
  v_ped erp_pedidos%ROWTYPE;
  v_emp companies%ROWTYPE;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = v_os.pedido_id;
  SELECT * INTO v_emp FROM companies     WHERE id = v_os.company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa', jsonb_build_object(
      'nome', COALESCE(v_emp.nome_fantasia, v_emp.razao_social),
      'razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'endereco', v_emp.endereco, 'cidade_estado', v_emp.cidade_estado,
      'ie', v_emp.inscricao_estadual, 'im', v_emp.inscricao_municipal
    ),
    'os', jsonb_build_object(
      'numero', v_os.numero, 'status', v_os.status,
      'equipamento', v_os.equipamento, 'defeito_relatado', v_os.defeito_relatado,
      'descricao_servico', v_os.descricao_servico, 'diagnostico', v_os.diagnostico,
      'solucao', v_os.solucao, 'tecnico_nome', v_os.tecnico_nome,
      'horas_previstas', v_os.horas_previstas, 'horas_executadas', v_os.horas_executadas,
      'valor_hora', v_os.valor_hora,
      'mao_obra_estimada', COALESCE(v_os.valor_hora,0) * COALESCE(v_os.horas_executadas,0),
      'assinatura_cliente', v_os.assinatura_cliente, 'assinatura_data', v_os.assinatura_data,
      'data_abertura', v_os.data_abertura, 'data_conclusao', v_os.data_conclusao
    ),
    'pedido', CASE WHEN v_ped.id IS NULL THEN NULL ELSE jsonb_build_object(
      'numero', v_ped.numero, 'data_pedido', v_ped.data_pedido,
      'cliente_nome', v_ped.cliente_nome, 'cliente_cnpj', v_ped.cliente_cnpj,
      'cliente_email', v_ped.cliente_email, 'cliente_telefone', v_ped.cliente_telefone,
      'subtotal', v_ped.subtotal, 'desconto_valor', v_ped.desconto_valor, 'total', v_ped.total
    ) END,
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'descricao', CASE WHEN i.tipo_item='servico' THEN COALESCE(i.servico_descricao, i.produto_nome)
                          ELSE COALESCE(i.produto_nome, i.produto_descricao) END,
        'tipo_item', i.tipo_item, 'quantidade', i.quantidade, 'unidade', i.unidade,
        'preco_unitario', i.preco_unitario, 'subtotal', i.subtotal
      ) ORDER BY i.ordem)
      FROM erp_pedidos_itens i WHERE i.pedido_id = v_os.pedido_id
    ), '[]'::jsonb),
    'parcelas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'numero', pa.numero, 'valor', pa.valor, 'vencimento', pa.vencimento,
        'forma_pagamento', pa.forma_pagamento
      ) ORDER BY pa.numero)
      FROM erp_pedidos_parcelas pa WHERE pa.pedido_id = v_os.pedido_id
    ), '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.fn_os_imprimir_dados(uuid) TO authenticated;
