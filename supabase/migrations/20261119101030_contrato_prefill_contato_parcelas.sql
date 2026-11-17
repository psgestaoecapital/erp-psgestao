-- Prospecção → Contrato pré-preenchido: CONTATO do cliente + nº de parcelas viajam nas DUAS portas
--
-- SPEC Eng. Chefe (RD-41), complementa a opção "gerar agora". Diagnóstico (RD-38): o elo proposta→contrato
-- (fn_agency_proposta_aprovar) e a porta manual (fn_contrato_solicitar) já existem, mas (gap 1) não carregam
-- cliente_email/cliente_telefone do cadastro, e (gap 2) a aprovação da proposta não grava numero_parcelas.
-- As colunas cliente_email/cliente_telefone/numero_parcelas/data_fim já existem em erp_contratos (sem DDL).
--
-- ADITIVA/CORRETIVA e REVERSÍVEL: só acrescenta contato + parcelas ao INSERT das 2 funções e +params opcionais
-- (não quebra chamadas). Fonte do contato = erp_clientes (email; telefone = COALESCE(celular, whatsapp, telefone))
-- da MESMA empresa (PII já existente no cadastro — sem nova exposição cross-tenant). Guardas inalteradas.
-- Reverter: recriar as 2 funções sem o contato/parcelas (DROP da nova fn_agency_proposta_aprovar + recria a 8-arg).

-- ============================================================================================
-- (0) RD-38 (achado na prova): erp_contratos.cliente_telefone era varchar(20) — curto demais para o telefone
--     do cadastro (texto livre, ex.: "(49) 3664-0353 Pessoal: (49) 98815-6286"). Alarga para text (widening,
--     sem reescrita/perda; antes a coluna vinha sempre NULL, então o limite nunca pegava). cliente_email já é
--     varchar(150) — suficiente.
-- ============================================================================================
ALTER TABLE public.erp_contratos ALTER COLUMN cliente_telefone TYPE text;

-- ============================================================================================
-- (b) fn_contrato_solicitar (porta manual) — contato de p_dados ou do cadastro do cliente
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_solicitar(p_company_id uuid, p_proposta_id uuid DEFAULT NULL::uuid, p_dados jsonb DEFAULT '{}'::jsonb, p_prazo_desejado date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_numero varchar; v_id uuid; v_prop record; v_resp uuid; v_n_fin int;
  v_cli_id uuid; v_cli_nome text; v_cli_doc text; v_valor numeric; v_escopo text; v_titulo text; v_origem text;
  v_cli_email text; v_cli_tel text;
  v_d jsonb := COALESCE(p_dados, '{}'::jsonb);
  v_cond text; v_inicio date; v_fim date; v_venc1 date; v_dia int; v_nparc int; v_reaj_pct numeric;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  v_inicio   := NULLIF(v_d->>'data_inicio','')::date;
  v_fim      := NULLIF(v_d->>'data_fim','')::date;
  v_venc1    := NULLIF(v_d->>'data_primeiro_vencimento','')::date;
  v_dia      := NULLIF(v_d->>'dia_vencimento','')::int;
  v_nparc    := NULLIF(v_d->>'numero_parcelas','')::int;
  v_reaj_pct := NULLIF(v_d->>'reajuste_percentual','')::numeric;
  IF v_dia IS NOT NULL AND (v_dia < 1 OR v_dia > 28) THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_invalido'); END IF;
  IF v_nparc IS NOT NULL AND v_nparc < 1 THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_invalido'); END IF;
  IF v_inicio IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_inicio THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_invalida'); END IF;

  IF COALESCE(btrim(v_d->>'titulo'),'') = '' THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_inicio IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_inicio_obrigatoria'); END IF;
  IF v_fim IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_fim_obrigatoria'); END IF;
  IF v_nparc IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_obrigatorio'); END IF;
  IF v_dia IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_obrigatorio'); END IF;
  IF v_venc1 IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','primeiro_vencimento_obrigatorio'); END IF;

  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro'; END IF;

  v_cond := NULLIF(btrim(v_d->>'condicao_pagamento'),'');
  IF p_proposta_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM agency_propostas WHERE id = p_proposta_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','proposta_nao_encontrada'); END IF;
    v_origem := 'proposta';
    v_cli_id := COALESCE(v_prop.erp_cliente_id, v_prop.cliente_id);
    v_titulo := COALESCE(NULLIF(btrim(v_d->>'titulo'),''), NULLIF(btrim(v_prop.titulo),''), 'Contrato da proposta '||v_prop.numero);
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
  -- CONTATO (gap 1): do payload (editado no front) ou do cadastro do cliente da MESMA empresa.
  v_cli_email := COALESCE(NULLIF(btrim(v_d->>'cliente_email'),''), (SELECT NULLIF(btrim(email),'') FROM erp_clientes WHERE id = v_cli_id));
  v_cli_tel   := COALESCE(NULLIF(btrim(v_d->>'cliente_telefone'),''), (SELECT NULLIF(btrim(COALESCE(celular, whatsapp, telefone)),'') FROM erp_clientes WHERE id = v_cli_id));

  v_numero := next_contrato_numero(p_company_id);
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone, tipo, nome, objeto, escopo,
    valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade,
    forma_pagamento, condicao_pagamento, numero_parcelas, tipo_reajuste, reajuste_percentual,
    responsavel, condicoes_especificas,
    status, origem, proposta_id, solicitante_id, responsavel_id,
    prazo_desejado, observacoes, codigo_identificador, natureza, created_by)
  VALUES (p_company_id, v_numero, v_cli_id, v_cli_nome, v_cli_doc, v_cli_email, v_cli_tel,
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
REVOKE ALL ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) TO authenticated, service_role;

-- ============================================================================================
-- (a) fn_agency_proposta_aprovar — + contato + numero_parcelas + data_fim (DROP 8-arg, recria com +params)
-- ============================================================================================
DROP FUNCTION IF EXISTS public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text);
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_aprovar(
    p_proposta_id uuid, p_fee_mensal numeric DEFAULT NULL::numeric, p_dia_vencimento integer DEFAULT 10,
    p_periodicidade text DEFAULT 'mensal'::text, p_data_inicio date DEFAULT NULL::date, p_comissao_percentual numeric DEFAULT 0,
    p_comissao_tipo text DEFAULT 'unica'::text, p_comissao_base text DEFAULT 'contrato'::text,
    p_numero_parcelas integer DEFAULT NULL, p_data_fim date DEFAULT NULL, p_cliente_email text DEFAULT NULL, p_cliente_telefone text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_p agency_propostas%ROWTYPE;
  v_uid uuid := auth.uid();
  v_fee numeric; v_ini date; v_contrato uuid; v_num text;
  v_base numeric; v_pct numeric; v_valcom numeric; v_comissao uuid;
  v_cli_fk uuid; v_cli_nome text; v_cli_doc text; v_escopo text; v_objeto text;
  v_cli_email text; v_cli_tel text;
  v_resp uuid; v_n_fin int; v_existente uuid;
BEGIN
  SELECT * INTO v_p FROM agency_propostas WHERE id = p_proposta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

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
  v_num := next_contrato_numero(v_p.company_id);

  -- PEDIDO de contrato: status 'solicitado'; agora carrega contato (gap 1) e nº de parcelas/data_fim (gap 2).
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone, tipo, nome, objeto, escopo,
      valor_mensal, valor_atual, data_inicio, data_fim, dia_vencimento, periodicidade, numero_parcelas, forma_pagamento, condicao_pagamento,
      status, origem, proposta_id, solicitante_id, responsavel_id, natureza, created_by, observacoes)
  VALUES (v_p.company_id, v_num, v_cli_fk, v_cli_nome, v_cli_doc, v_cli_email, v_cli_tel, 'servico', v_p.titulo, v_objeto, v_escopo,
      v_fee, v_fee, v_ini, p_data_fim, COALESCE(p_dia_vencimento,10), COALESCE(p_periodicidade,'mensal'), p_numero_parcelas, 'boleto', NULLIF(btrim(v_p.condicao_pagamento),''),
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
REVOKE ALL ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text) TO authenticated, service_role;

-- ============================================================================================
-- (4) Ajuda (RD-95) do bloco "Dados para o financeiro" no modal de aprovação da proposta (/pm/propostas)
-- ============================================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('pm.propostas.numero_parcelas','/dashboard/pm/propostas','Propostas','Nº de parcelas',
   'Em quantas parcelas o fee será cobrado. Vem do que foi combinado com o cliente.',
   'Sem o nº de parcelas, o financeiro não sabe em quantas vezes faturar o contrato.',
   'Fee de 12 meses cobrado mês a mês = 12 parcelas.',
   'Deixar em branco e o financeiro ter que adivinhar / perguntar de volta ao comercial.',
   'pm',10,1,'publicado'),
  ('pm.propostas.data_fim','/dashboard/pm/propostas','Propostas','Fim da vigência',
   'A data em que o contrato termina (fim da vigência).',
   'Fecha o período do contrato e ajuda a calcular as parcelas até o fim.',
   'Contrato de 1 ano começando hoje → fim daqui a 12 meses.',
   'Deixar aberto quando o contrato tem prazo definido.',
   'pm',20,1,'publicado'),
  ('pm.propostas.cliente_email','/dashboard/pm/propostas','Propostas','E-mail do cliente',
   'O e-mail de contato do cliente (já vem do cadastro; ajuste se mudou).',
   'Sem o e-mail, o financeiro não tem para onde enviar boleto/cobrança e nota.',
   'financeiro@cliente.com.br',
   'Aprovar sem contato e a cobrança ficar sem destino.',
   'pm',30,1,'publicado'),
  ('pm.propostas.cliente_telefone','/dashboard/pm/propostas','Propostas','Telefone do cliente',
   'O telefone/WhatsApp de contato do cliente (já vem do cadastro; ajuste se mudou).',
   'Dá ao financeiro um canal para cobrar e resolver pendências com o cliente.',
   '(49) 99999-0000 — Rogério.',
   'Aprovar sem telefone e o financeiro não conseguir falar com o cliente.',
   'pm',40,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
