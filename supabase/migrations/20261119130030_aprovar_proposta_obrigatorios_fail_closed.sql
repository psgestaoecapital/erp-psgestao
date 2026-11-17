-- SPEC Master Júlia (Pdois) §3 · amarrar os obrigatórios do comercial NOS DOIS LADOS.
--
-- Defeito (RD-38): a aprovação da proposta (fn_agency_proposta_aprovar) gerava o PEDIDO de contrato
-- aceitando os campos como opcionais — o CTR-2026-0019 (fee R$ 5.400) nasceu SEM data_fim, nº de parcelas,
-- CNPJ, 1º vencimento e contato, e o financeiro recebeu incompleto. A porta manual (fn_contrato_solicitar)
-- já é fail-closed (item 4A); esta porta não era.
--
-- Correção (aditiva ao comportamento, reversível): quando a aprovação faz NASCER um contrato de fee
-- (v_fee > 0), valida ANTES de inserir, com a MESMA régua da fn_contrato_solicitar (RD-26) + CNPJ + contato
-- (SPEC §3). Fee 0 (projeto avulso, sem faturamento recorrente) segue como antes — só a comissão. Também
-- passa a gravar data_primeiro_vencimento (novo parâmetro) no pedido, para paridade total com a porta manual.
--
-- SENSÍVEL (CREATE de função de núcleo comercial→financeiro). Mudança de assinatura: +1 parâmetro no fim.

DROP FUNCTION IF EXISTS public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text);

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_aprovar(
  p_proposta_id uuid,
  p_fee_mensal numeric DEFAULT NULL::numeric,
  p_dia_vencimento integer DEFAULT 10,
  p_periodicidade text DEFAULT 'mensal'::text,
  p_data_inicio date DEFAULT NULL::date,
  p_comissao_percentual numeric DEFAULT 0,
  p_comissao_tipo text DEFAULT 'unica'::text,
  p_comissao_base text DEFAULT 'contrato'::text,
  p_numero_parcelas integer DEFAULT NULL::integer,
  p_data_fim date DEFAULT NULL::date,
  p_cliente_email text DEFAULT NULL::text,
  p_cliente_telefone text DEFAULT NULL::text,
  p_data_primeiro_vencimento date DEFAULT NULL::date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p agency_propostas%ROWTYPE;
  v_uid uuid := auth.uid();
  v_fee numeric; v_ini date; v_venc1 date; v_contrato uuid; v_num text;
  v_base numeric; v_pct numeric; v_valcom numeric; v_comissao uuid;
  v_cli_fk uuid; v_cli_nome text; v_cli_doc text; v_escopo text; v_objeto text;
  v_cli_email text; v_cli_tel text;
  v_resp uuid; v_n_fin int; v_existente uuid;
BEGIN
  SELECT * INTO v_p FROM agency_propostas WHERE id = p_proposta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- Idempotência: proposta já aprovada / contrato já existe → não revalida nem recria.
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

  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro'; END IF;

  v_cli_fk := v_p.erp_cliente_id;
  v_cli_nome := COALESCE((SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT COALESCE(nome_fantasia, nome) FROM agency_clientes WHERE id = v_p.cliente_id), 'Cliente');
  v_cli_doc  := COALESCE((SELECT NULLIF(btrim(cnpj_cpf),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT NULLIF(btrim(cnpj_cpf),'') FROM agency_clientes WHERE id = v_p.cliente_id));
  -- CONTATO (gap 1): do param (editado no front) ou do cadastro do cliente (erp_clientes) da MESMA empresa.
  v_cli_email := COALESCE(NULLIF(btrim(p_cliente_email),''), (SELECT NULLIF(btrim(email),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id));
  v_cli_tel   := COALESCE(NULLIF(btrim(p_cliente_telefone),''), (SELECT NULLIF(btrim(COALESCE(celular, whatsapp, telefone)),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id));

  SELECT COALESCE(SUM(valor_total),0) INTO v_fee FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  IF v_fee = 0 THEN v_fee := COALESCE(v_p.valor_final, v_p.valor_total, 0); END IF;
  v_fee := COALESCE(p_fee_mensal, v_fee);
  SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
    INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  v_objeto := NULLIF(btrim(v_p.descricao),'');
  v_ini := COALESCE(p_data_inicio, current_date);
  v_venc1 := p_data_primeiro_vencimento;

  -- SPEC §3 · FAIL-CLOSED: quando nasce um contrato de fee (v_fee > 0), o pedido NÃO pode ir incompleto
  -- para o financeiro. Mesma régua da fn_contrato_solicitar (item 4A) + CNPJ + contato. Mensagens traduzidas
  -- no front (traduz/ codigoAmigavel). Projeto avulso (fee 0) não exige nada — só gera a comissão.
  IF COALESCE(v_fee,0) > 0 THEN
    IF p_dia_vencimento IS NOT NULL AND (p_dia_vencimento < 1 OR p_dia_vencimento > 28) THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_invalido'); END IF;
    IF p_numero_parcelas IS NOT NULL AND p_numero_parcelas < 1 THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_invalido'); END IF;
    IF p_data_fim IS NOT NULL AND p_data_fim < v_ini THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_invalida'); END IF;
    IF COALESCE(btrim(v_p.titulo),'') = '' THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
    IF p_data_fim IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_fim_obrigatoria'); END IF;
    IF p_numero_parcelas IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_obrigatorio'); END IF;
    IF p_dia_vencimento IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_obrigatorio'); END IF;
    IF v_venc1 IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','primeiro_vencimento_obrigatorio'); END IF;
    IF COALESCE(btrim(v_cli_doc),'') = '' THEN RETURN jsonb_build_object('ok',false,'erro','cnpj_cliente_obrigatorio'); END IF;
    IF v_cli_email IS NULL AND v_cli_tel IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','contato_obrigatorio'); END IF;
  END IF;

  v_num := next_contrato_numero(v_p.company_id);

  -- PEDIDO de contrato: status 'solicitado'; carrega contato (gap 1), nº de parcelas/data_fim (gap 2) e 1º venc (§3).
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone, tipo, nome, objeto, escopo,
      valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade, numero_parcelas, forma_pagamento, condicao_pagamento,
      status, origem, proposta_id, solicitante_id, responsavel_id, natureza, created_by, observacoes)
  VALUES (v_p.company_id, v_num, v_cli_fk, v_cli_nome, v_cli_doc, v_cli_email, v_cli_tel, 'servico', v_p.titulo, v_objeto, v_escopo,
      v_fee, v_fee, v_ini, p_data_fim, v_venc1, COALESCE(p_dia_vencimento,10), COALESCE(p_periodicidade,'mensal'), p_numero_parcelas, 'boleto', NULLIF(btrim(v_p.condicao_pagamento),''),
      'solicitado', 'proposta', p_proposta_id, v_uid, v_resp, 'receita', v_uid,
      'Pedido de contrato gerado na aprovação da proposta ' || COALESCE(v_p.numero, v_p.id::text))
  RETURNING id INTO v_contrato;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (v_contrato, v_p.company_id, 'solicitado',
    format('Pedido de contrato gerado na aprovação da proposta%s', CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin, 'origem', 'aprovacao'), v_uid, now());

  v_pct  := COALESCE(p_comissao_percentual, 0);
  v_base := CASE WHEN p_comissao_base = 'fee' THEN v_fee ELSE COALESCE(v_p.valor_final, 0) END;
  v_valcom := round(v_base * v_pct / 100.0, 2);
  INSERT INTO agency_comissao (company_id, proposta_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status, tipo)
  VALUES (v_p.company_id, p_proposta_id, v_p.responsavel_id, v_base, v_pct, v_valcom, date_trunc('month', v_ini)::date, 'prevista', COALESCE(p_comissao_tipo,'unica'))
  RETURNING id INTO v_comissao;

  UPDATE agency_propostas SET status = 'aprovada', data_aprovacao = now(), contrato_id = v_contrato, updated_at = now()
   WHERE id = p_proposta_id;

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

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço.
REVOKE ALL ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text, date) TO authenticated, service_role;

-- RD-95: "?" do novo campo "1º vencimento" na aprovação de proposta (aditivo, idempotente).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT 'pm.propostas.primeiro_vencimento', '/dashboard/pm/propostas', 'Propostas', '1º vencimento',
       'A data em que vence a primeira parcela do contrato.',
       'Define a partir de quando o financeiro gera as cobranças; as parcelas seguintes seguem o dia do vencimento.',
       'Contrato começando hoje, primeira parcela no dia 10 do mês que vem.',
       'Colocar uma data já vencida ou anterior ao início do contrato.',
       'pm', 25, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'pm.propostas.primeiro_vencimento');
