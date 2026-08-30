-- SIC-F1 · RPCs. 🧊 O ramo ELSE (Sicoob/Bradesco, mtls) preserva a lógica ATUAL byte a byte — o
-- integracao_habilitada e os campos existentes ficam iguais. As chaves novas (auth_tipo, tem_api_key,
-- cooperativa, posto, valida_cep_pagador, falta) são ADITIVAS (retrocompatíveis) — reportado ao CEO.

-- 2.1 · régua de "integração habilitada" que hoje é Sicoob-cêntrica e reprova o Sicredi por construção
CREATE OR REPLACE FUNCTION public.fn_banco_integracao_estado(
  p_company_id uuid, p_banco_codigo text, p_ambiente text DEFAULT 'producao')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cfg record; v_man record; v_tem_cert boolean; v_ok boolean; v_falta text[];
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  SELECT * INTO v_cfg FROM erp_banco_provider_config
   WHERE company_id=p_company_id AND banco_codigo=p_banco_codigo AND ambiente=p_ambiente;
  SELECT * INTO v_man FROM erp_banco_manifesto WHERE banco_codigo=p_banco_codigo;
  SELECT EXISTS(SELECT 1 FROM erp_certificados_a1
    WHERE company_id=p_company_id AND status='ativo' AND validade_fim::date>=CURRENT_DATE)
  INTO v_tem_cert;
  v_falta := ARRAY[]::text[];
  -- array_append (não `|| 'literal'`: text[] || unknown resolve p/ anyarray||anyarray e quebra quando falta algo)
  IF v_cfg.id IS NULL THEN
    v_ok := false; v_falta := ARRAY['configuracao nao cadastrada'];
  ELSIF COALESCE(v_man.auth_tipo,'mtls') = 'apikey_oauth_password' THEN
    -- Sicredi: x-api-key + Código de Acesso + coop/posto/beneficiário. SEM certificado, SEM client_id.
    IF v_cfg.api_key_vault_id       IS NULL THEN v_falta := array_append(v_falta,'Access Token (x-api-key)'); END IF;
    IF v_cfg.client_secret_vault_id IS NULL THEN v_falta := array_append(v_falta,'Código de Acesso'); END IF;
    IF COALESCE(v_cfg.cooperativa,'')         = '' THEN v_falta := array_append(v_falta,'cooperativa'); END IF;
    IF COALESCE(v_cfg.posto,'')               = '' THEN v_falta := array_append(v_falta,'posto'); END IF;
    IF COALESCE(v_cfg.codigo_beneficiario,'') = '' THEN v_falta := array_append(v_falta,'código do beneficiário'); END IF;
    v_ok := (array_length(v_falta,1) IS NULL);
  ELSE
    -- Sicoob/Bradesco: comportamento ORIGINAL preservado (client_id + secret + cert A1 válido).
    IF v_cfg.client_id              IS NULL THEN v_falta := array_append(v_falta,'client_id'); END IF;
    IF v_cfg.client_secret_vault_id IS NULL THEN v_falta := array_append(v_falta,'client_secret'); END IF;
    IF NOT v_tem_cert                       THEN v_falta := array_append(v_falta,'certificado A1 válido'); END IF;
    v_ok := (v_cfg.client_id IS NOT NULL AND v_cfg.client_secret_vault_id IS NOT NULL AND v_tem_cert);
  END IF;
  RETURN jsonb_build_object(
    'existe', v_cfg.id IS NOT NULL, 'ambiente', p_ambiente,
    'auth_tipo', COALESCE(v_man.auth_tipo,'mtls'),
    'client_id', v_cfg.client_id,
    'tem_client_secret', v_cfg.client_secret_vault_id IS NOT NULL,
    'tem_api_key', v_cfg.api_key_vault_id IS NOT NULL,
    'tem_certificado_a1', v_tem_cert,
    'cap_boleto', COALESCE(v_cfg.cap_boleto,false),
    'cap_extrato', COALESCE(v_cfg.cap_extrato,false),
    'cap_pagamento', COALESCE(v_cfg.cap_pagamento,false),
    'cooperativa', v_cfg.cooperativa, 'posto', v_cfg.posto,
    'codigo_beneficiario', v_cfg.codigo_beneficiario,
    'agencia', v_cfg.agencia, 'conta', v_cfg.conta,
    'carteira', v_cfg.carteira, 'convenio', v_cfg.convenio,
    'juros_pct', v_cfg.juros_pct, 'multa_pct', v_cfg.multa_pct,
    'dias_compensacao', v_cfg.dias_compensacao, 'dias_protesto', v_cfg.dias_protesto,
    'instrucao_linha1', v_cfg.instrucao_linha1, 'instrucao_linha2', v_cfg.instrucao_linha2,
    'instrucao_linha3', v_cfg.instrucao_linha3, 'instrucao_linha4', v_cfg.instrucao_linha4,
    'gerar_pix', COALESCE(v_cfg.gerar_pix,false),
    'banco_conta_id', v_cfg.banco_conta_id,
    'valida_cep_pagador', v_cfg.valida_cep_pagador,   -- NULL = desconhecido
    'falta', v_falta,
    'integracao_habilitada', COALESCE(v_ok,false)
  );
END $$;

-- 2.2 · seuNumero: 10 chars, obrigatório. UUID NÃO CABE.
CREATE OR REPLACE FUNCTION public.fn_banco_proximo_seu_numero(
  p_company_id uuid, p_banco_codigo text, p_ambiente text DEFAULT 'producao')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_seq integer;
BEGIN
  UPDATE erp_banco_provider_config SET boleto_seq = boleto_seq + 1, updated_at = now()
   WHERE company_id=p_company_id AND banco_codigo=p_banco_codigo AND ambiente=p_ambiente
  RETURNING boleto_seq INTO v_seq;
  IF v_seq IS NULL THEN RAISE EXCEPTION 'config bancaria nao encontrada'; END IF;
  RETURN to_char(now(),'YY') || lpad(v_seq::text, 8, '0');  -- ex.: 2600000001 (10 chars)
END $$;
REVOKE ALL ON FUNCTION public.fn_banco_proximo_seu_numero(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_banco_proximo_seu_numero(uuid,text,text) TO service_role;

-- 2.3 · registrar passo da escada de teste
CREATE OR REPLACE FUNCTION public.fn_banco_teste_registrar(
  p_company_id uuid, p_provider text, p_passo text, p_status text, p_detalhe jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_passo NOT IN ('oauth','boleto','pdf','extrato','baixa') THEN
    RETURN jsonb_build_object('ok',false,'erro','passo invalido');
  END IF;
  IF p_status NOT IN ('ok','falhou','nao_testado') THEN
    RETURN jsonb_build_object('ok',false,'erro','status invalido');
  END IF;
  DELETE FROM erp_banco_teste_resultado
   WHERE company_id=p_company_id AND provider=p_provider AND passo=p_passo;
  INSERT INTO erp_banco_teste_resultado (company_id, provider, passo, status, detalhe, testado_em)
  VALUES (p_company_id, p_provider, p_passo, p_status, p_detalhe, now());
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_banco_teste_registrar(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_banco_teste_registrar(uuid,text,text,text,jsonb) TO service_role;
