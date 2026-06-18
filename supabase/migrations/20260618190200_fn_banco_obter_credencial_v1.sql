-- banco-multi-fase1 · obter credencial decifrada para a edge
-- service_role only. SECURITY DEFINER.
-- Retorna jsonb com client_id + secrets decifrados + dados de cobranca.

CREATE OR REPLACE FUNCTION public.fn_banco_obter_credencial(
  p_company_id   uuid,
  p_banco_codigo text,
  p_ambiente     text DEFAULT 'producao'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  c record;
  v_client_secret text;
  v_cert text;
  v_cert_senha text;
BEGIN
  SELECT *
    INTO c
    FROM public.erp_banco_provider_config
   WHERE company_id   = p_company_id
     AND banco_codigo = p_banco_codigo
     AND ambiente     = p_ambiente
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'credencial nao cadastrada');
  END IF;
  IF NOT c.ativo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'credencial inativa');
  END IF;

  IF c.client_secret_vault_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_client_secret
      FROM vault.decrypted_secrets WHERE id = c.client_secret_vault_id LIMIT 1;
  END IF;
  IF c.cert_vault_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_cert
      FROM vault.decrypted_secrets WHERE id = c.cert_vault_id LIMIT 1;
  END IF;
  IF c.cert_senha_vault_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_cert_senha
      FROM vault.decrypted_secrets WHERE id = c.cert_senha_vault_id LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'banco_codigo',  c.banco_codigo,
    'provider',      c.provider,
    'ambiente',      c.ambiente,
    'ativo',         c.ativo,
    'client_id',     c.client_id,
    'client_secret', v_client_secret,
    'cert_base64',   v_cert,
    'cert_senha',    v_cert_senha,
    'agencia',       c.agencia,
    'conta',         c.conta,
    'cooperativa',   c.cooperativa,
    'codigo_beneficiario', c.codigo_beneficiario,
    'convenio',      c.convenio,
    'carteira',      c.carteira,
    'cap_extrato',   c.cap_extrato,
    'cap_boleto',    c.cap_boleto,
    'cap_pagamento', c.cap_pagamento,
    'cursor_extrato', c.cursor_extrato
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_banco_obter_credencial(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_banco_obter_credencial(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.fn_banco_obter_credencial(uuid, text, text) IS
'banco-multi-fase1 · service_role only. Decifra secrets do Vault e devolve credencial pronta pra edge.';
