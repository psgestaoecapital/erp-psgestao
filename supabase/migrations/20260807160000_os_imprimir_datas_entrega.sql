-- Cabeçalho da OS impressa · datas (Jordana). A OS marca conclusão em entregue_em/data_execucao —
-- data_conclusao fica nula na KGF. O documento só recebia data_conclusao, então "Concluída/Entregue em"
-- nunca saía no papel. Aqui o bloco 'cabecalho' passa a devolver também entregue_em e data_execucao,
-- pro cabeçalho impresso mostrar a data de conclusão/entrega quando houver. Resto do documento idêntico
-- (empresa/itens/resumo/fotos/os/pedido/parcelas inalterados). RD-26/RD-51.
CREATE OR REPLACE FUNCTION public.fn_os_imprimir_dados(p_os_id uuid, p_incluir_fotos boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_ped erp_pedidos%ROWTYPE; v_emp companies%ROWTYPE; v_ramo text;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = v_os.pedido_id;
  SELECT * INTO v_emp FROM companies WHERE id = v_os.company_id;
  SELECT COALESCE(ramo, 'automotiva') INTO v_ramo FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  v_ramo := COALESCE(v_ramo, 'automotiva');
  RETURN jsonb_build_object(
    'ok', true, 'ramo', v_ramo,
    'empresa', jsonb_build_object(
      'nome', COALESCE(v_emp.nome_fantasia, v_emp.razao_social),
      'razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'endereco', v_emp.endereco, 'cidade_estado', v_emp.cidade_estado,
      'ie', v_emp.inscricao_estadual, 'im', v_emp.inscricao_municipal,
      'logo', v_emp.logo_url),
    'cabecalho', jsonb_build_object(
      'numero', v_os.numero, 'status', v_os.status,
      'data_abertura', v_os.data_abertura, 'data_conclusao', v_os.data_conclusao,
      'data_execucao', v_os.data_execucao, 'entregue_em', v_os.entregue_em,
      'placa', v_os.placa, 'km', v_os.km,
      'veiculo', NULLIF(btrim(COALESCE(v_os.marca,'') || ' ' || COALESCE(v_os.modelo,'')), ''),
      'marca', v_os.marca, 'modelo', v_os.modelo, 'ano', v_os.ano,
      'cliente_nome', btrim(COALESCE(v_os.cliente_nome, v_ped.cliente_nome, '')),
      'cliente_cnpj', COALESCE(v_os.cliente_cnpj, v_ped.cliente_cnpj),
      'defeito_relatado', v_os.defeito_relatado, 'diagnostico', v_os.diagnostico,
      'tecnico_nome', v_os.tecnico_nome),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'descricao', i.descricao, 'detalhe', NULLIF(btrim(COALESCE(i.observacao,'')), ''),
        'tipo', i.tipo, 'quantidade', i.quantidade,
        'preco_unit', CASE WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN NULL ELSE i.preco END,
        'subtotal',   CASE WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN NULL
                           ELSE ROUND(COALESCE(i.preco,0) * COALESCE(i.quantidade,1), 2) END,
        'aprovado', i.aprovado,
        'status_item', CASE WHEN i.aprovado IS TRUE THEN 'aprovado'
                            WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN 'recusado' ELSE 'pendente' END,
        'severidade', i.severidade) ORDER BY i.ordem, i.created_at)
      FROM erp_os_diagnostico_item i WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id), '[]'::jsonb),
    'resumo', (
      SELECT jsonb_build_object(
        'total_aprovado', COALESCE(SUM(ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) FILTER (WHERE i.aprovado IS TRUE), 0),
        'total_orcamento', COALESCE(SUM(ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) FILTER (WHERE NOT (i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL)), 0),
        'qtd_aprovados', COUNT(*) FILTER (WHERE i.aprovado IS TRUE),
        'qtd_pendentes', COUNT(*) FILTER (WHERE i.aprovado IS NULL OR (i.aprovado IS FALSE AND i.aprovado_em IS NULL)),
        'qtd_recusados', COUNT(*) FILTER (WHERE i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL))
      FROM erp_os_diagnostico_item i WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id),
    'fotos', CASE WHEN p_incluir_fotos THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('foto_path', f.foto_path, 'descricao', f.descricao,
          'autor', f.criado_por_nome, 'data', f.created_at, 'etapa', f.etapa) ORDER BY f.created_at)
        FROM erp_os_registro_foto f WHERE f.os_id = p_os_id AND f.company_id = v_os.company_id), '[]'::jsonb) ELSE NULL END,
    'os', jsonb_build_object(
      'numero', v_os.numero, 'status', v_os.status, 'equipamento', v_os.equipamento, 'defeito_relatado', v_os.defeito_relatado,
      'descricao_servico', v_os.descricao_servico, 'diagnostico', v_os.diagnostico, 'solucao', v_os.solucao,
      'tecnico_nome', v_os.tecnico_nome, 'assinatura_cliente', v_os.assinatura_cliente, 'assinatura_data', v_os.assinatura_data,
      'data_abertura', v_os.data_abertura, 'data_conclusao', v_os.data_conclusao),
    'pedido', CASE WHEN v_ped.id IS NULL THEN NULL ELSE jsonb_build_object(
      'numero', v_ped.numero, 'data_pedido', v_ped.data_pedido, 'cliente_nome', v_ped.cliente_nome,
      'cliente_cnpj', v_ped.cliente_cnpj, 'subtotal', v_ped.subtotal, 'desconto_valor', v_ped.desconto_valor, 'total', v_ped.total) END,
    'parcelas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('numero', pa.numero, 'valor', pa.valor, 'vencimento', pa.vencimento,
        'forma_pagamento', pa.forma_pagamento) ORDER BY pa.numero)
      FROM erp_pedidos_parcelas pa WHERE pa.pedido_id = v_os.pedido_id), '[]'::jsonb));
END; $function$;