-- Fundação bancária: slot da x-api-key (Sicredi usa API-key, não cert A1 no handshake)
-- + tornar fn_banco_salvar/obter_credencial cientes da api_key
-- + fn_boleto_liquidar provider-agnóstico (default sicoob p/ backward-compat).

-- 1) Coluna do slot (id do secret no Vault).
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS api_key_vault_id uuid;

-- 2) fn_banco_salvar_credencial + p_api_key (grava no Vault, guarda o id).
DROP FUNCTION IF EXISTS public.fn_banco_salvar_credencial(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fn_banco_salvar_credencial(
  p_company_id uuid, p_banco_codigo text, p_provider text, p_ambiente text,
  p_client_id text DEFAULT NULL, p_client_secret text DEFAULT NULL,
  p_cert_base64 text DEFAULT NULL, p_cert_senha text DEFAULT NULL,
  p_agencia text DEFAULT NULL, p_conta text DEFAULT NULL, p_cooperativa text DEFAULT NULL,
  p_codigo_beneficiario text DEFAULT NULL, p_convenio text DEFAULT NULL, p_carteira text DEFAULT NULL,
  p_cap_extrato boolean DEFAULT NULL, p_cap_boleto boolean DEFAULT NULL, p_cap_pagamento boolean DEFAULT NULL,
  p_ativo boolean DEFAULT NULL, p_api_key text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_uid uuid; v_existing record;
  v_clisec_id uuid; v_cert_id uuid; v_certpw_id uuid; v_apikey_id uuid;
  v_name_base text; v_secret_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;
  IF p_ambiente NOT IN ('producao','homologacao') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ambiente invalido');
  END IF;

  v_name_base := 'banco_' || lower(p_provider) || '_' || p_ambiente || '_' || p_company_id::text;

  SELECT client_secret_vault_id, cert_vault_id, cert_senha_vault_id, api_key_vault_id
    INTO v_existing
    FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ambiente = p_ambiente;

  -- client_secret
  IF p_client_secret IS NOT NULL AND length(btrim(p_client_secret)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_clisecret';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_client_secret)); v_clisec_id := v_secret_id;
    ELSE v_clisec_id := vault.create_secret(btrim(p_client_secret), v_name_base || '_clisecret',
      'Banco ' || p_provider || ' client_secret (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_clisec_id := v_existing.client_secret_vault_id; END IF;

  -- cert (mTLS, base64 PEM/PFX)
  IF p_cert_base64 IS NOT NULL AND length(btrim(p_cert_base64)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_cert';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_cert_base64)); v_cert_id := v_secret_id;
    ELSE v_cert_id := vault.create_secret(btrim(p_cert_base64), v_name_base || '_cert',
      'Banco ' || p_provider || ' cert mTLS (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_cert_id := v_existing.cert_vault_id; END IF;

  -- senha do cert
  IF p_cert_senha IS NOT NULL AND length(btrim(p_cert_senha)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_certpw';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_cert_senha)); v_certpw_id := v_secret_id;
    ELSE v_certpw_id := vault.create_secret(btrim(p_cert_senha), v_name_base || '_certpw',
      'Banco ' || p_provider || ' cert senha (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_certpw_id := v_existing.cert_senha_vault_id; END IF;

  -- x-api-key (Sicredi e afins)
  IF p_api_key IS NOT NULL AND length(btrim(p_api_key)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_apikey';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_api_key)); v_apikey_id := v_secret_id;
    ELSE v_apikey_id := vault.create_secret(btrim(p_api_key), v_name_base || '_apikey',
      'Banco ' || p_provider || ' x-api-key (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_apikey_id := v_existing.api_key_vault_id; END IF;

  INSERT INTO public.erp_banco_provider_config (
    company_id, banco_codigo, provider, ambiente,
    client_id, client_secret_vault_id, cert_vault_id, cert_senha_vault_id, api_key_vault_id,
    agencia, conta, cooperativa, codigo_beneficiario, convenio, carteira,
    cap_extrato, cap_boleto, cap_pagamento, ativo, created_by, updated_by
  ) VALUES (
    p_company_id, p_banco_codigo, p_provider, p_ambiente,
    p_client_id, v_clisec_id, v_cert_id, v_certpw_id, v_apikey_id,
    p_agencia, p_conta, p_cooperativa, p_codigo_beneficiario, p_convenio, p_carteira,
    COALESCE(p_cap_extrato, false), COALESCE(p_cap_boleto, false), COALESCE(p_cap_pagamento, false),
    COALESCE(p_ativo, false), v_uid, v_uid
  )
  ON CONFLICT (company_id, banco_codigo, ambiente) DO UPDATE
  SET provider = EXCLUDED.provider,
      client_id = COALESCE(EXCLUDED.client_id, public.erp_banco_provider_config.client_id),
      client_secret_vault_id = v_clisec_id, cert_vault_id = v_cert_id, cert_senha_vault_id = v_certpw_id,
      api_key_vault_id = v_apikey_id,
      agencia = COALESCE(EXCLUDED.agencia, public.erp_banco_provider_config.agencia),
      conta = COALESCE(EXCLUDED.conta, public.erp_banco_provider_config.conta),
      cooperativa = COALESCE(EXCLUDED.cooperativa, public.erp_banco_provider_config.cooperativa),
      codigo_beneficiario = COALESCE(EXCLUDED.codigo_beneficiario, public.erp_banco_provider_config.codigo_beneficiario),
      convenio = COALESCE(EXCLUDED.convenio, public.erp_banco_provider_config.convenio),
      carteira = COALESCE(EXCLUDED.carteira, public.erp_banco_provider_config.carteira),
      cap_extrato = COALESCE(p_cap_extrato, public.erp_banco_provider_config.cap_extrato),
      cap_boleto = COALESCE(p_cap_boleto, public.erp_banco_provider_config.cap_boleto),
      cap_pagamento = COALESCE(p_cap_pagamento, public.erp_banco_provider_config.cap_pagamento),
      ativo = COALESCE(p_ativo, public.erp_banco_provider_config.ativo),
      updated_at = now(), updated_by = v_uid;

  RETURN jsonb_build_object('ok', true,
    'client_secret_vault_id', v_clisec_id, 'cert_vault_id', v_cert_id,
    'cert_senha_vault_id', v_certpw_id, 'api_key_vault_id', v_apikey_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, boolean, text) TO authenticated;

-- 3) fn_banco_obter_credencial: retornar api_key junto.
CREATE OR REPLACE FUNCTION public.fn_banco_obter_credencial(p_company_id uuid, p_banco_codigo text, p_ambiente text DEFAULT 'producao')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE c record; v_client_secret text; v_cert text; v_cert_senha text; v_api_key text;
BEGIN
  SELECT * INTO c FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ambiente = p_ambiente LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'credencial nao cadastrada'); END IF;
  IF NOT c.ativo THEN RETURN jsonb_build_object('ok', false, 'erro', 'credencial inativa'); END IF;

  IF c.client_secret_vault_id IS NOT NULL THEN SELECT decrypted_secret INTO v_client_secret FROM vault.decrypted_secrets WHERE id = c.client_secret_vault_id LIMIT 1; END IF;
  IF c.cert_vault_id IS NOT NULL THEN SELECT decrypted_secret INTO v_cert FROM vault.decrypted_secrets WHERE id = c.cert_vault_id LIMIT 1; END IF;
  IF c.cert_senha_vault_id IS NOT NULL THEN SELECT decrypted_secret INTO v_cert_senha FROM vault.decrypted_secrets WHERE id = c.cert_senha_vault_id LIMIT 1; END IF;
  IF c.api_key_vault_id IS NOT NULL THEN SELECT decrypted_secret INTO v_api_key FROM vault.decrypted_secrets WHERE id = c.api_key_vault_id LIMIT 1; END IF;

  RETURN jsonb_build_object('ok', true,
    'banco_codigo', c.banco_codigo, 'provider', c.provider, 'ambiente', c.ambiente, 'ativo', c.ativo,
    'client_id', c.client_id, 'client_secret', v_client_secret, 'cert_base64', v_cert, 'cert_senha', v_cert_senha,
    'api_key', v_api_key,
    'agencia', c.agencia, 'conta', c.conta, 'cooperativa', c.cooperativa,
    'codigo_beneficiario', c.codigo_beneficiario, 'convenio', c.convenio, 'carteira', c.carteira,
    'nu_negociacao', c.nu_negociacao, 'juros_pct', c.juros_pct, 'multa_pct', c.multa_pct,
    'instrucao_linha1', c.instrucao_linha1, 'instrucao_linha2', c.instrucao_linha2,
    'instrucao_linha3', c.instrucao_linha3, 'instrucao_linha4', c.instrucao_linha4,
    'cap_extrato', c.cap_extrato, 'cap_boleto', c.cap_boleto, 'cap_pagamento', c.cap_pagamento,
    'cursor_extrato', c.cursor_extrato);
END;
$function$;

-- 4) fn_boleto_liquidar provider-agnóstico (default 'sicoob'/'756' = backward-compat).
DROP FUNCTION IF EXISTS public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb);

CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(
  p_company_id uuid, p_nosso_numero text, p_data_pagamento date,
  p_valor_pago numeric DEFAULT NULL, p_provider_raw jsonb DEFAULT '{}'::jsonb,
  p_provider text DEFAULT 'sicoob', p_banco_codigo text DEFAULT '756')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_receber record; v_conta_id uuid; v_baixa jsonb;
BEGIN
  SELECT id, status, valor, boleto_status INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id AND boleto_nosso_numero = p_nosso_numero
  ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado', 'nosso_numero', p_nosso_numero);
  END IF;
  IF v_receber.boleto_status = 'liquidado' OR v_receber.status = 'pago' THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true, 'receber_id', v_receber.id);
  END IF;

  -- conta destino: config ativa do provider (default sicoob)
  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND provider = p_provider AND ambiente = 'producao' AND ativo = true
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id := v_receber.id, p_data_pagamento := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id, p_forma_pagamento := 'BOLETO',
    p_valor_pago := COALESCE(p_valor_pago, v_receber.valor));

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa', 'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  UPDATE erp_receber SET boleto_status = 'liquidado', boleto_pago_em = NOW() WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES (p_company_id, p_banco_codigo, p_provider, 'boleto_liquidar', 'ok', 1,
        format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento), p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id, 'nosso_numero', p_nosso_numero, 'baixa', v_baixa);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) TO authenticated, service_role;
