-- Contrato de Fee · Impressão / PDF — SPEC Master Júlia (Eng. Chefe, RD-41) seção 1
--
-- RPC de LEITURA guardada que devolve, numa chamada só, tudo para montar o documento de impressão do
-- Contrato de Fee (emitente/faturadora, cliente com contato, contrato, parcelas com status). Nenhuma IA.
-- Nada é escrito (só SELECT). Multi-tenant fail-closed. RD-26: reaproveita o dado existente, sem tabela nova.

CREATE OR REPLACE FUNCTION public.fn_contrato_fee_impressao(p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_c record; v_emp record; v_fat record; v_cli record;
  v_parcelas jsonb; v_total numeric;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;

  -- Pilar 2 (LGPD): guarda de empresa fail-closed. service/interno e admin passam; usuário só na própria empresa.
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Emitente do documento = empresa faturadora (COALESCE empresa_faturadora_id, company_id).
  SELECT * INTO v_emp FROM companies WHERE id = COALESCE(v_c.empresa_faturadora_id, v_c.company_id);
  -- Empresa de origem do contrato (para "Faturado por" quando difere da faturadora).
  SELECT * INTO v_fat FROM companies WHERE id = v_c.company_id;
  -- Cliente (contato que o #5266 passa a gravar; fallback para o cadastro).
  SELECT * INTO v_cli FROM erp_clientes WHERE id = v_c.cliente_id;

  SELECT COALESCE(SUM(valor), 0) INTO v_total FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'numero', p.numero,
    'vencimento', p.vencimento,
    'valor', p.valor,
    'forma_pagamento', p.forma_pagamento,
    'conta', bc.nome,
    'status', r.status          -- status da conta a receber (quando a parcela já virou título); NULL = ainda não gerada
  ) ORDER BY p.numero), '[]'::jsonb) INTO v_parcelas
  FROM erp_contrato_parcelas p
  LEFT JOIN erp_banco_contas bc ON bc.id = p.conta_bancaria_id
  LEFT JOIN erp_receber r ON r.id = p.receber_id
  WHERE p.contrato_id = p_contrato_id;

  RETURN jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'emitente', jsonb_build_object(
      'nome_fantasia', v_emp.nome_fantasia, 'razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'logradouro', v_emp.logradouro, 'numero', v_emp.numero, 'bairro', v_emp.bairro, 'complemento', v_emp.complemento,
      'cidade', v_emp.cidade, 'uf', v_emp.uf_fiscal, 'cep', v_emp.cep, 'endereco', v_emp.endereco,
      'inscricao_municipal', v_emp.inscricao_municipal, 'logo_url', v_emp.logo_url
    ),
    'faturada_por_diferente', (v_c.empresa_faturadora_id IS NOT NULL AND v_c.empresa_faturadora_id <> v_c.company_id),
    'empresa_origem', jsonb_build_object('nome_fantasia', v_fat.nome_fantasia, 'razao_social', v_fat.razao_social),
    'cliente', jsonb_build_object(
      'razao_social', COALESCE(v_cli.razao_social, v_c.cliente_nome),
      'nome_fantasia', v_cli.nome_fantasia,
      'cnpj_cpf', COALESCE(v_cli.cpf_cnpj, v_cli.cnpj_cpf, v_c.cliente_cnpj),
      'logradouro', v_cli.logradouro, 'numero', v_cli.numero, 'bairro', v_cli.bairro,
      'cidade', v_cli.cidade, 'uf', v_cli.uf, 'cep', v_cli.cep, 'endereco', v_cli.endereco,
      'email', COALESCE(NULLIF(btrim(v_c.cliente_email),''), v_cli.email),
      'telefone', COALESCE(NULLIF(btrim(v_c.cliente_telefone),''), v_cli.celular, v_cli.whatsapp, v_cli.telefone)
    ),
    'contrato', jsonb_build_object(
      'numero', v_c.numero, 'codigo_identificador', v_c.codigo_identificador,
      'nome', v_c.nome, 'objeto', v_c.objeto, 'escopo', v_c.escopo, 'observacoes', v_c.observacoes,
      'periodicidade', v_c.periodicidade, 'data_inicio', v_c.data_inicio, 'data_fim', v_c.data_fim,
      'numero_parcelas', v_c.numero_parcelas, 'valor_mensal', v_c.valor_mensal, 'valor_total', v_total,
      'condicao_pagamento', v_c.condicao_pagamento, 'forma_pagamento', v_c.forma_pagamento,
      'status', v_c.status, 'responsavel', v_c.responsavel, 'texto_legal', v_c.texto_legal
    ),
    'parcelas', v_parcelas
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_fee_impressao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_fee_impressao(uuid) TO authenticated, service_role;
