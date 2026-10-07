-- #57/#59 · fn_contrato_solicitar avisa o financeiro (sino) com link ao contrato na Gestão Empresarial.
-- Único acréscimo ao corpo vivo: INSERT em erp_notificacao_usuario quando há responsável financeiro único.
CREATE OR REPLACE FUNCTION public.fn_contrato_solicitar(p_company_id uuid, p_proposta_id uuid DEFAULT NULL::uuid, p_dados jsonb DEFAULT '{}'::jsonb, p_prazo_desejado date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_numero varchar; v_id uuid; v_prop record; v_resp uuid; v_n_fin int;
  v_cli_id uuid; v_cli_nome text; v_cli_doc text; v_valor numeric; v_escopo text; v_titulo text; v_origem text;
  v_d jsonb := COALESCE(p_dados, '{}'::jsonb);
  v_cond text; v_inicio date; v_fim date; v_venc1 date; v_dia int; v_nparc int; v_reaj_pct numeric;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  -- campos de pagamento/vigência (valem nos dois modos) — validados antes de gravar qualquer coisa
  v_inicio   := NULLIF(v_d->>'data_inicio','')::date;
  v_fim      := NULLIF(v_d->>'data_fim','')::date;
  v_venc1    := NULLIF(v_d->>'data_primeiro_vencimento','')::date;
  v_dia      := NULLIF(v_d->>'dia_vencimento','')::int;
  v_nparc    := NULLIF(v_d->>'numero_parcelas','')::int;
  v_reaj_pct := NULLIF(v_d->>'reajuste_percentual','')::numeric;
  IF v_dia IS NOT NULL AND (v_dia < 1 OR v_dia > 28) THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_invalido'); END IF;
  IF v_nparc IS NOT NULL AND v_nparc < 1 THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_invalido'); END IF;
  IF v_inicio IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_inicio THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_invalida'); END IF;

  -- responsável = único usuário com role 'financeiro' na empresa (0 ou >1 → nulo + aviso)
  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro'; END IF;

  v_cond := NULLIF(btrim(v_d->>'condicao_pagamento'),'');
  IF p_proposta_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM agency_propostas WHERE id = p_proposta_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','proposta_nao_encontrada'); END IF;
    v_origem := 'proposta';
    v_cli_id := COALESCE(v_prop.erp_cliente_id, v_prop.cliente_id);
    v_titulo := COALESCE(NULLIF(btrim(v_d->>'titulo'),''), NULLIF(btrim(v_prop.titulo),''), 'Contrato da proposta '||v_prop.numero);
    -- valor RECALCULADO dos itens (fonte da verdade), fallback ao valor_final da proposta; o comercial pode informar outro
    SELECT COALESCE(SUM(valor_total),0) INTO v_valor FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
    IF v_valor = 0 THEN v_valor := COALESCE(v_prop.valor_final, v_prop.valor_total, 0); END IF;
    v_valor := COALESCE(NULLIF(v_d->>'valor_mensal','')::numeric, v_valor);
    SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
      INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
    v_escopo := COALESCE(NULLIF(btrim(v_d->>'escopo'),''), v_escopo);
    v_cond := COALESCE(v_cond, NULLIF(btrim(v_prop.condicao_pagamento),''));
  ELSE
    v_origem := 'manual';
    v_cli_id := NULLIF(v_d->>'cliente_id','')::uuid;
    v_titulo := COALESCE(NULLIF(btrim(v_d->>'titulo'),''), NULLIF(btrim(v_d->>'nome'),''), 'Contrato');
    v_valor := COALESCE(NULLIF(v_d->>'valor_mensal','')::numeric, 0);
    v_escopo := NULLIF(btrim(v_d->>'escopo'),'');
    IF v_cli_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli_id AND company_id = p_company_id) THEN
      RETURN jsonb_build_object('ok',false,'erro','cliente_de_outra_empresa'); END IF;
  END IF;
  v_cli_nome := COALESCE(NULLIF(btrim(v_d->>'cliente_nome'),''), (SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_cli_id));
  v_cli_doc  := COALESCE(NULLIF(btrim(v_d->>'cliente_cnpj'),''), (SELECT NULLIF(btrim(cnpj_cpf),'') FROM erp_clientes WHERE id = v_cli_id));

  v_numero := next_contrato_numero(p_company_id);
  -- data_inicio é NOT NULL na tabela; sem data informada, no 'solicitado' é um placeholder (o real é definido na elaboração).
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, tipo, nome, objeto, escopo,
    valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade,
    forma_pagamento, condicao_pagamento, numero_parcelas, tipo_reajuste, reajuste_percentual,
    responsavel, condicoes_especificas,
    status, origem, proposta_id, solicitante_id, responsavel_id,
    prazo_desejado, observacoes, codigo_identificador, natureza, created_by)
  VALUES (p_company_id, v_numero, v_cli_id, v_cli_nome, v_cli_doc,
    COALESCE(NULLIF(btrim(v_d->>'tipo'),''),'servico'), v_titulo, NULLIF(btrim(v_d->>'objeto'),''), v_escopo,
    v_valor, v_valor, COALESCE(v_inicio, CURRENT_DATE), v_fim, v_venc1, COALESCE(v_dia, 10),
    COALESCE(NULLIF(btrim(v_d->>'periodicidade'),''), 'mensal'),
    COALESCE(NULLIF(btrim(v_d->>'forma_pagamento'),''), 'boleto'), v_cond, v_nparc,
    COALESCE(NULLIF(btrim(v_d->>'tipo_reajuste'),''), 'nenhum'), COALESCE(v_reaj_pct, 0),
    NULLIF(btrim(v_d->>'responsavel'),''), NULLIF(btrim(v_d->>'condicoes_especificas'),''),
    'solicitado', v_origem, p_proposta_id, v_uid, v_resp,
    p_prazo_desejado, p_observacoes, NULLIF(btrim(v_d->>'codigo_identificador'),''), 'receita', v_uid)
  RETURNING id INTO v_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (v_id, p_company_id, 'solicitado',
    format('Contrato solicitado (%s)%s', v_origem, CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin), v_uid, now());

  -- #57/#59 · avisa o financeiro (sino) com link para o contrato na Gestão Empresarial
  IF v_resp IS NOT NULL THEN
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (p_company_id, v_resp, 'contrato_solicitado', 'Contrato solicitado '||v_numero,
      format('%s — %s', COALESCE(v_cli_nome,'cliente'), v_titulo),
      '/dashboard/contratos?tab=fee&c='||v_id, 'erp_contratos', v_id, v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_numero, 'responsavel_id', v_resp,
    'aviso', CASE WHEN v_resp IS NULL THEN 'sem responsável financeiro único (0 ou >1) — defina manualmente' ELSE NULL END);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) TO authenticated, service_role;
