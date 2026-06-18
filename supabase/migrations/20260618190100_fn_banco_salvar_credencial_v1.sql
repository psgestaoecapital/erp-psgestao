-- banco-multi-fase1 · salvar credencial bancaria
-- Cria/atualiza secrets no Vault com nome deterministico:
--   banco_<provider>_<ambiente>_<company>_<tipo>
-- e grava os *_vault_id + dados de cobranca + capacidades.
-- Args nulos = nao alterar aquele secret (importante pra rotacao parcial).
-- Pilar 2: secret nunca retorna · so {ok, ids}.

CREATE OR REPLACE FUNCTION public.fn_banco_salvar_credencial(
  p_company_id          uuid,
  p_banco_codigo        text,
  p_provider            text,
  p_ambiente            text,
  p_client_id           text DEFAULT NULL,
  p_client_secret       text DEFAULT NULL,
  p_cert_base64         text DEFAULT NULL,
  p_cert_senha          text DEFAULT NULL,
  p_agencia             text DEFAULT NULL,
  p_conta               text DEFAULT NULL,
  p_cooperativa         text DEFAULT NULL,
  p_codigo_beneficiario text DEFAULT NULL,
  p_convenio            text DEFAULT NULL,
  p_carteira            text DEFAULT NULL,
  p_cap_extrato         boolean DEFAULT NULL,
  p_cap_boleto          boolean DEFAULT NULL,
  p_cap_pagamento       boolean DEFAULT NULL,
  p_ativo               boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_uid uuid;
  v_existing record;
  v_clisec_id uuid;
  v_cert_id   uuid;
  v_certpw_id uuid;
  v_name_base text;
  v_secret_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_companies
    WHERE user_id = v_uid AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;
  IF p_ambiente NOT IN ('producao','homologacao') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ambiente invalido');
  END IF;

  v_name_base := 'banco_' || lower(p_provider) || '_' || p_ambiente || '_' || p_company_id::text;

  SELECT client_secret_vault_id, cert_vault_id, cert_senha_vault_id
    INTO v_existing
    FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id
     AND banco_codigo = p_banco_codigo
     AND ambiente = p_ambiente;

  IF p_client_secret IS NOT NULL AND length(btrim(p_client_secret)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_clisecret';
    IF v_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_secret_id, btrim(p_client_secret));
      v_clisec_id := v_secret_id;
    ELSE
      v_clisec_id := vault.create_secret(
        btrim(p_client_secret),
        v_name_base || '_clisecret',
        'Banco ' || p_provider || ' client_secret (' || p_ambiente || ', company ' || p_company_id::text || ')'
      );
    END IF;
  ELSE
    v_clisec_id := v_existing.client_secret_vault_id;
  END IF;

  IF p_cert_base64 IS NOT NULL AND length(btrim(p_cert_base64)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_cert';
    IF v_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_secret_id, btrim(p_cert_base64));
      v_cert_id := v_secret_id;
    ELSE
      v_cert_id := vault.create_secret(
        btrim(p_cert_base64),
        v_name_base || '_cert',
        'Banco ' || p_provider || ' cert mTLS (' || p_ambiente || ', company ' || p_company_id::text || ')'
      );
    END IF;
  ELSE
    v_cert_id := v_existing.cert_vault_id;
  END IF;

  IF p_cert_senha IS NOT NULL AND length(btrim(p_cert_senha)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_certpw';
    IF v_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_secret_id, btrim(p_cert_senha));
      v_certpw_id := v_secret_id;
    ELSE
      v_certpw_id := vault.create_secret(
        btrim(p_cert_senha),
        v_name_base || '_certpw',
        'Banco ' || p_provider || ' cert senha (' || p_ambiente || ', company ' || p_company_id::text || ')'
      );
    END IF;
  ELSE
    v_certpw_id := v_existing.cert_senha_vault_id;
  END IF;

  INSERT INTO public.erp_banco_provider_config (
    company_id, banco_codigo, provider, ambiente,
    client_id, client_secret_vault_id, cert_vault_id, cert_senha_vault_id,
    agencia, conta, cooperativa, codigo_beneficiario, convenio, carteira,
    cap_extrato, cap_boleto, cap_pagamento, ativo,
    created_by, updated_by
  ) VALUES (
    p_company_id, p_banco_codigo, p_provider, p_ambiente,
    p_client_id, v_clisec_id, v_cert_id, v_certpw_id,
    p_agencia, p_conta, p_cooperativa, p_codigo_beneficiario, p_convenio, p_carteira,
    COALESCE(p_cap_extrato, false),
    COALESCE(p_cap_boleto, false),
    COALESCE(p_cap_pagamento, false),
    COALESCE(p_ativo, false),
    v_uid, v_uid
  )
  ON CONFLICT (company_id, banco_codigo, ambiente) DO UPDATE
  SET provider              = EXCLUDED.provider,
      client_id             = COALESCE(EXCLUDED.client_id, public.erp_banco_provider_config.client_id),
      client_secret_vault_id= v_clisec_id,
      cert_vault_id         = v_cert_id,
      cert_senha_vault_id   = v_certpw_id,
      agencia               = COALESCE(EXCLUDED.agencia, public.erp_banco_provider_config.agencia),
      conta                 = COALESCE(EXCLUDED.conta, public.erp_banco_provider_config.conta),
      cooperativa           = COALESCE(EXCLUDED.cooperativa, public.erp_banco_provider_config.cooperativa),
      codigo_beneficiario   = COALESCE(EXCLUDED.codigo_beneficiario, public.erp_banco_provider_config.codigo_beneficiario),
      convenio              = COALESCE(EXCLUDED.convenio, public.erp_banco_provider_config.convenio),
      carteira              = COALESCE(EXCLUDED.carteira, public.erp_banco_provider_config.carteira),
      cap_extrato           = COALESCE(p_cap_extrato, public.erp_banco_provider_config.cap_extrato),
      cap_boleto            = COALESCE(p_cap_boleto, public.erp_banco_provider_config.cap_boleto),
      cap_pagamento         = COALESCE(p_cap_pagamento, public.erp_banco_provider_config.cap_pagamento),
      ativo                 = COALESCE(p_ativo, public.erp_banco_provider_config.ativo),
      updated_at            = now(),
      updated_by            = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'client_secret_vault_id', v_clisec_id,
    'cert_vault_id',          v_cert_id,
    'cert_senha_vault_id',    v_certpw_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text,
  text, text, text, text,
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text,
  text, text, text, text,
  text, text, text, text, text, text,
  boolean, boolean, boolean, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_banco_salvar_credencial IS
'banco-multi-fase1 · salva credencial bancaria upsertando secrets no Vault. Args nulos preservam valor anterior. Retorna so os vault_ids.';
