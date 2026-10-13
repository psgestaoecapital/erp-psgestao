-- Melhoria (Rodrigo · tela de conexões bancárias) — VALIDADE DO CERTIFICADO na lista.
-- Autoria: sessão Claude (pedido do Rodrigo, aprovado pelo CEO).
--
-- Problema (registrado em erp_contexto_projeto d1910579): a validade que aparece hoje vem da tabela de
-- RESULTADO DE TESTE, populada só quando alguém clica "Testar conexão" — pode estar vazia com certificado
-- válido, ou desatualizada. Certificado vencido derruba a integração sem aviso.
--
-- Correção: extrair a validade do próprio certificado NO SALVAR (node-forge, notAfter — a rota
-- /api/banco/cert-pfx já lê isso) e gravar em coluna persistente. O semáforo da tela passa a ler daqui.
--
-- ⚠️ ESCRITA, não leitura: só a fn de SALVAR (fn_banco_salvar_credencial) muda, com UM parâmetro novo
-- OPCIONAL no fim (p_cert_expira_em). fn_banco_obter_credencial — o caminho que a emissão de boleto usa,
-- recém-provado com o Rodrigo (#14) — NÃO é tocada. Todas as chamadas JS de salvar usam parâmetros
-- NOMEADOS (supabase.rpc(name, {obj})); não há chamada SQL posicional — logo, acrescentar no fim é seguro.
-- A lógica de gravar no Vault e o UPDATE (sem cap_pagamento — RD-57) são reproduzidos IDÊNTICOS à versão
-- viva; só somam as duas colunas novas.

-- (1) colunas novas (ninguém lê hoje; default NULL = "validade desconhecida")
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS cert_expira_em date,
  ADD COLUMN IF NOT EXISTS cert_validado_em timestamptz;
COMMENT ON COLUMN public.erp_banco_provider_config.cert_expira_em IS
  'Validade (notAfter) do certificado mTLS, extraída no salvar. NULL = desconhecida (semáforo cinza).';
COMMENT ON COLUMN public.erp_banco_provider_config.cert_validado_em IS
  'Quando a validade do certificado foi extraída (no último salvar com cert novo).';

-- (2) DROP da assinatura viva (20 params) antes de recriar com 21 — acrescentar param com DEFAULT cria
--     OVERLOAD (ambiguidade na RPC), não replace. Assinatura viva confirmada em pg_get_functiondef.
DROP FUNCTION IF EXISTS public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text);

CREATE OR REPLACE FUNCTION public.fn_banco_salvar_credencial(
  p_company_id uuid, p_banco_codigo text, p_provider text, p_ambiente text,
  p_client_id text DEFAULT NULL, p_client_secret text DEFAULT NULL,
  p_cert_base64 text DEFAULT NULL, p_cert_senha text DEFAULT NULL,
  p_agencia text DEFAULT NULL, p_conta text DEFAULT NULL, p_cooperativa text DEFAULT NULL,
  p_codigo_beneficiario text DEFAULT NULL, p_convenio text DEFAULT NULL, p_carteira text DEFAULT NULL,
  p_cap_extrato boolean DEFAULT NULL, p_cap_boleto boolean DEFAULT NULL, p_cap_pagamento boolean DEFAULT NULL,
  p_ativo boolean DEFAULT NULL, p_api_key text DEFAULT NULL, p_posto text DEFAULT NULL,
  p_cert_expira_em date DEFAULT NULL)                     -- NOVO: validade do cert (extraída no cliente via node-forge)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_uid uuid; v_existing record;
  v_clisec_id uuid; v_cert_id uuid; v_certpw_id uuid; v_apikey_id uuid;
  v_name_base text; v_secret_id uuid;
  v_cert_novo boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa'); END IF;
  IF p_ambiente NOT IN ('producao','homologacao') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ambiente invalido'); END IF;
  v_name_base := 'banco_' || lower(p_provider) || '_' || p_ambiente || '_' || p_company_id::text;
  v_cert_novo := (p_cert_base64 IS NOT NULL AND length(btrim(p_cert_base64)) > 0);

  SELECT client_secret_vault_id, cert_vault_id, cert_senha_vault_id, api_key_vault_id, cert_expira_em, cert_validado_em
    INTO v_existing FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ambiente = p_ambiente;

  IF p_client_secret IS NOT NULL AND length(btrim(p_client_secret)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_clisecret';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_client_secret)); v_clisec_id := v_secret_id;
    ELSE v_clisec_id := vault.create_secret(btrim(p_client_secret), v_name_base || '_clisecret',
      'Banco ' || p_provider || ' client_secret/password (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_clisec_id := v_existing.client_secret_vault_id; END IF;

  IF v_cert_novo THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_cert';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_cert_base64)); v_cert_id := v_secret_id;
    ELSE v_cert_id := vault.create_secret(btrim(p_cert_base64), v_name_base || '_cert',
      'Banco ' || p_provider || ' cert mTLS (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_cert_id := v_existing.cert_vault_id; END IF;

  IF p_cert_senha IS NOT NULL AND length(btrim(p_cert_senha)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_certpw';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_cert_senha)); v_certpw_id := v_secret_id;
    ELSE v_certpw_id := vault.create_secret(btrim(p_cert_senha), v_name_base || '_certpw',
      'Banco ' || p_provider || ' cert senha (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_certpw_id := v_existing.cert_senha_vault_id; END IF;

  IF p_api_key IS NOT NULL AND length(btrim(p_api_key)) > 0 THEN
    SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_name_base || '_apikey';
    IF v_secret_id IS NOT NULL THEN PERFORM vault.update_secret(v_secret_id, btrim(p_api_key)); v_apikey_id := v_secret_id;
    ELSE v_apikey_id := vault.create_secret(btrim(p_api_key), v_name_base || '_apikey',
      'Banco ' || p_provider || ' x-api-key (' || p_ambiente || ', company ' || p_company_id::text || ')'); END IF;
  ELSE v_apikey_id := v_existing.api_key_vault_id; END IF;

  INSERT INTO public.erp_banco_provider_config (
    company_id, banco_codigo, provider, ambiente,
    client_id, client_secret_vault_id, cert_vault_id, cert_senha_vault_id, api_key_vault_id,
    agencia, conta, cooperativa, posto, codigo_beneficiario, convenio, carteira,
    cap_extrato, cap_boleto, cap_pagamento, ativo,
    cert_expira_em, cert_validado_em, created_by, updated_by
  ) VALUES (
    p_company_id, p_banco_codigo, p_provider, p_ambiente,
    p_client_id, v_clisec_id, v_cert_id, v_certpw_id, v_apikey_id,
    p_agencia, p_conta, p_cooperativa, p_posto, p_codigo_beneficiario, p_convenio, p_carteira,
    COALESCE(p_cap_extrato, false), COALESCE(p_cap_boleto, false), COALESCE(p_cap_pagamento, false),
    COALESCE(p_ativo, false),
    CASE WHEN v_cert_novo THEN p_cert_expira_em ELSE NULL END,
    CASE WHEN v_cert_novo THEN now() ELSE NULL END,
    v_uid, v_uid
  )
  ON CONFLICT (company_id, banco_codigo, ambiente) DO UPDATE
  SET provider = EXCLUDED.provider,
      client_id = COALESCE(EXCLUDED.client_id, public.erp_banco_provider_config.client_id),
      client_secret_vault_id = v_clisec_id, cert_vault_id = v_cert_id, cert_senha_vault_id = v_certpw_id,
      api_key_vault_id = v_apikey_id,
      agencia = COALESCE(EXCLUDED.agencia, public.erp_banco_provider_config.agencia),
      conta = COALESCE(EXCLUDED.conta, public.erp_banco_provider_config.conta),
      cooperativa = COALESCE(EXCLUDED.cooperativa, public.erp_banco_provider_config.cooperativa),
      posto = COALESCE(EXCLUDED.posto, public.erp_banco_provider_config.posto),
      codigo_beneficiario = COALESCE(EXCLUDED.codigo_beneficiario, public.erp_banco_provider_config.codigo_beneficiario),
      convenio = COALESCE(EXCLUDED.convenio, public.erp_banco_provider_config.convenio),
      carteira = COALESCE(EXCLUDED.carteira, public.erp_banco_provider_config.carteira),
      cap_extrato = COALESCE(p_cap_extrato, public.erp_banco_provider_config.cap_extrato),
      cap_boleto = COALESCE(p_cap_boleto, public.erp_banco_provider_config.cap_boleto),
      ativo = COALESCE(p_ativo, public.erp_banco_provider_config.ativo),
      -- só atualiza a validade quando um cert NOVO foi enviado; senão preserva a existente (RD-57: nunca
      -- sobrescrever com base em parâmetro que não veio). cap_pagamento continua fora do UPDATE (RD-57).
      cert_expira_em = CASE WHEN v_cert_novo THEN p_cert_expira_em ELSE public.erp_banco_provider_config.cert_expira_em END,
      cert_validado_em = CASE WHEN v_cert_novo THEN now() ELSE public.erp_banco_provider_config.cert_validado_em END,
      updated_at = now(), updated_by = v_uid;

  RETURN jsonb_build_object('ok', true, 'client_secret_vault_id', v_clisec_id, 'cert_vault_id', v_cert_id,
    'cert_senha_vault_id', v_certpw_id, 'api_key_vault_id', v_apikey_id,
    'cert_expira_em', CASE WHEN v_cert_novo THEN p_cert_expira_em ELSE v_existing.cert_expira_em END);
END;
$function$;

-- Guardas (check-fn-guards): SECURITY DEFINER fechada ao anon; autoria por auth.uid() (mantida).
REVOKE ALL ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text, date) TO authenticated, service_role;
