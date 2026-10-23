-- CEO 14/10 (Pdois) · UM CAMINHO SÓ: aprovar a proposta cria o PEDIDO de contrato (erp_contratos status 'solicitado',
-- origem 'proposta', solicitante = quem aprovou, dados preenchidos como no modal "Solicitar elaboração") — NÃO mais um
-- contrato 'ativo'. O financeiro elabora e ativa; só então gera cobrança.
--
-- Antiduplicidade: 1 contrato NÃO cancelado por proposta (não cria um 2º pedido; devolve o existente).
-- Preenche o pedido a partir da proposta/itens/cadastro, igual à fn_contrato_solicitar (cliente por
-- COALESCE(erp_cliente_id, cliente_id), valor somado dos itens, escopo dos itens, condição da proposta) e avisa o
-- responsável financeiro (mesmo caminho de notificação). A comissão continua sendo registrada na aprovação.
--
-- CREATE OR REPLACE da MESMA assinatura (financeiro/aprovação) — via revisada.

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_aprovar(p_proposta_id uuid, p_fee_mensal numeric DEFAULT NULL::numeric, p_dia_vencimento int DEFAULT 10, p_periodicidade text DEFAULT 'mensal'::text, p_data_inicio date DEFAULT NULL::date, p_comissao_percentual numeric DEFAULT 0, p_comissao_tipo text DEFAULT 'unica'::text, p_comissao_base text DEFAULT 'contrato'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p agency_propostas%ROWTYPE;
  v_uid uuid := auth.uid();
  v_fee numeric; v_ini date; v_contrato uuid; v_num text;
  v_base numeric; v_pct numeric; v_valcom numeric; v_comissao uuid;
  v_cli_fk uuid; v_cli_nome text; v_cli_doc text; v_escopo text; v_objeto text;
  v_resp uuid; v_n_fin int; v_existente uuid;
BEGIN
  SELECT * INTO v_p FROM agency_propostas WHERE id = p_proposta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- ANTIDUPLICIDADE: 1 contrato não cancelado por proposta. Se já houver (ou a proposta já estiver aprovada),
  -- não cria um 2º pedido — garante o vínculo e devolve o existente.
  SELECT id INTO v_existente FROM erp_contratos
   WHERE proposta_id = p_proposta_id AND COALESCE(status,'') NOT IN ('cancelado','excluido')
   ORDER BY created_at LIMIT 1;
  IF v_p.status = 'aprovada' OR v_existente IS NOT NULL THEN
    SELECT id INTO v_comissao FROM agency_comissao WHERE proposta_id = p_proposta_id ORDER BY criado_em LIMIT 1;
    IF v_p.status <> 'aprovada' OR v_p.contrato_id IS DISTINCT FROM v_existente THEN
      UPDATE agency_propostas
         SET status = 'aprovada', data_aprovacao = COALESCE(data_aprovacao, now()),
             contrato_id = COALESCE(contrato_id, v_existente), updated_at = now()
       WHERE id = p_proposta_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'ja_aprovada', true,
      'contrato_id', COALESCE(v_p.contrato_id, v_existente), 'comissao_id', v_comissao);
  END IF;

  -- responsável = único usuário 'financeiro' da empresa (0 ou >1 → nulo + aviso), igual à fn_contrato_solicitar
  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro'; END IF;

  -- cliente (como no modal): identidade por erp_clientes (erp_cliente_id) ou agency_clientes (cliente_id);
  -- a FK cliente_id do contrato só recebe o id de erp_clientes (nunca o id de agência).
  v_cli_fk := v_p.erp_cliente_id;
  v_cli_nome := COALESCE((SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT COALESCE(nome_fantasia, nome) FROM agency_clientes WHERE id = v_p.cliente_id), 'Cliente');
  v_cli_doc  := COALESCE((SELECT NULLIF(btrim(cnpj_cpf),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT NULLIF(btrim(cnpj_cpf),'') FROM agency_clientes WHERE id = v_p.cliente_id));

  -- valor: fee informado na aprovação → senão soma dos itens → senão valor_final/total da proposta
  SELECT COALESCE(SUM(valor_total),0) INTO v_fee FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  IF v_fee = 0 THEN v_fee := COALESCE(v_p.valor_final, v_p.valor_total, 0); END IF;
  v_fee := COALESCE(p_fee_mensal, v_fee);
  -- escopo + objeto da proposta (itens e descrição)
  SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
    INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  v_objeto := NULLIF(btrim(v_p.descricao),'');
  v_ini := COALESCE(p_data_inicio, current_date);
  v_num := next_contrato_numero(v_p.company_id);

  -- PEDIDO de contrato: status 'solicitado' (o financeiro elabora e ativa depois)
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, tipo, nome, objeto, escopo,
      valor_mensal, valor_atual, data_inicio, dia_vencimento, periodicidade, forma_pagamento, condicao_pagamento,
      status, origem, proposta_id, solicitante_id, responsavel_id, natureza, created_by, observacoes)
  VALUES (v_p.company_id, v_num, v_cli_fk, v_cli_nome, v_cli_doc, 'servico', v_p.titulo, v_objeto, v_escopo,
      v_fee, v_fee, v_ini, COALESCE(p_dia_vencimento,10), COALESCE(p_periodicidade,'mensal'), 'boleto', NULLIF(btrim(v_p.condicao_pagamento),''),
      'solicitado', 'proposta', p_proposta_id, v_uid, v_resp, 'receita', v_uid,
      'Pedido de contrato gerado na aprovação da proposta ' || COALESCE(v_p.numero, v_p.id::text))
  RETURNING id INTO v_contrato;

  -- trilha do pedido
  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (v_contrato, v_p.company_id, 'solicitado',
    format('Pedido de contrato gerado na aprovação da proposta%s', CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin, 'origem', 'aprovacao'), v_uid, now());

  -- comissão prevista (inalterado)
  v_pct  := COALESCE(p_comissao_percentual, 0);
  v_base := CASE WHEN p_comissao_base = 'fee' THEN v_fee ELSE COALESCE(v_p.valor_final, 0) END;
  v_valcom := round(v_base * v_pct / 100.0, 2);
  INSERT INTO agency_comissao (company_id, proposta_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status, tipo)
  VALUES (v_p.company_id, p_proposta_id, v_p.responsavel_id, v_base, v_pct, v_valcom, date_trunc('month', v_ini)::date, 'prevista', COALESCE(p_comissao_tipo,'unica'))
  RETURNING id INTO v_comissao;

  UPDATE agency_propostas SET status = 'aprovada', data_aprovacao = now(), contrato_id = v_contrato, updated_at = now()
   WHERE id = p_proposta_id;

  -- avisa o financeiro (sino) com link para o pedido de contrato (mesmo caminho da fn_contrato_solicitar)
  IF v_resp IS NOT NULL THEN
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (v_p.company_id, v_resp, 'contrato_solicitado', 'Contrato solicitado ' || v_num,
      format('%s — %s', COALESCE(v_cli_nome,'cliente'), COALESCE(v_p.titulo,'proposta aprovada')),
      '/dashboard/contratos?tab=fee&c=' || v_contrato, 'erp_contratos', v_contrato, v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_contrato, 'contrato_numero', v_num,
    'comissao_id', v_comissao, 'valor_comissao', v_valcom, 'fee_mensal', v_fee,
    'aviso', CASE WHEN v_resp IS NULL THEN 'sem responsável financeiro único (0 ou >1) — defina manualmente' ELSE NULL END);
END $function$;

-- SECURITY DEFINER: só usuário logado (a tela chama como authenticated) e o canal de serviço executam; nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, int, text, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, int, text, date, numeric, text, text) TO authenticated, service_role;
