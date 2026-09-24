-- TELA de encargos do boleto (Rodrigo/Bradesco) — persistir juros/multa/dias/instruções pela tela.
-- Autoria: sessão Claude (pedido do Rodrigo, aprovado pelo CEO).
--
-- Achado (RD-38, provado em pg_get_functiondef): a fn_banco_salvar_credencial NÃO grava juros_pct,
-- multa_pct, dias_multa, dias_juros nem instrucao_linha1..4 — o INSERT/UPDATE dela nem lista essas
-- colunas. Por isso o Rodrigo "não tem onde cadastrar" (o print do OMIE mostra o bloco que falta na
-- nossa tela) e os valores da R.R (1,5% / 2%) só entraram por SQL direto. Esta migration acrescenta
-- 8 parâmetros OPCIONAIS no FIM da assinatura para a tela salvar esses campos.
--
-- Semântica (respondendo à dúvida do CEO): "Dias para Compensação" (dias_compensacao) NÃO é o dia em
-- que o encargo passa a incidir — compensação é prazo de crédito/liquidação. O dia de início do encargo
-- é OUTRO conceito, e por isso usamos colunas próprias dias_multa/dias_juros (add em 20260924150000),
-- que o adapter mapeia para qtdeDiasMulta/qtdeDiasJuros do Bradesco. dias_compensacao fica intocado.
--
-- RD-57 preservado: cap_pagamento continua FORA do UPDATE; toda coluna nova entra por COALESCE (parâmetro
-- que não veio preserva o valor existente). Todas as chamadas JS usam parâmetros NOMEADOS — acrescentar
-- no fim é seguro (não há chamada posicional). DROP da assinatura de 21 params antes de recriar (add de
-- param com DEFAULT cria OVERLOAD/ambiguidade, não replace).

DROP FUNCTION IF EXISTS public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text, date);

CREATE OR REPLACE FUNCTION public.fn_banco_salvar_credencial(
  p_company_id uuid, p_banco_codigo text, p_provider text, p_ambiente text,
  p_client_id text DEFAULT NULL, p_client_secret text DEFAULT NULL,
  p_cert_base64 text DEFAULT NULL, p_cert_senha text DEFAULT NULL,
  p_agencia text DEFAULT NULL, p_conta text DEFAULT NULL, p_cooperativa text DEFAULT NULL,
  p_codigo_beneficiario text DEFAULT NULL, p_convenio text DEFAULT NULL, p_carteira text DEFAULT NULL,
  p_cap_extrato boolean DEFAULT NULL, p_cap_boleto boolean DEFAULT NULL, p_cap_pagamento boolean DEFAULT NULL,
  p_ativo boolean DEFAULT NULL, p_api_key text DEFAULT NULL, p_posto text DEFAULT NULL,
  p_cert_expira_em date DEFAULT NULL,
  -- NOVO (bloco de encargos do boleto — espelha o OMIE): % juros ao mês, % multa, dias após o
  -- vencimento p/ cada encargo incidir, e as 4 linhas de instrução. Tudo OPCIONAL (COALESCE preserva).
  p_juros_pct numeric DEFAULT NULL, p_multa_pct numeric DEFAULT NULL,
  p_dias_multa integer DEFAULT NULL, p_dias_juros integer DEFAULT NULL,
  p_instrucao_linha1 text DEFAULT NULL, p_instrucao_linha2 text DEFAULT NULL,
  p_instrucao_linha3 text DEFAULT NULL, p_instrucao_linha4 text DEFAULT NULL)
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
    cert_expira_em, cert_validado_em,
    juros_pct, multa_pct, dias_multa, dias_juros,
    instrucao_linha1, instrucao_linha2, instrucao_linha3, instrucao_linha4,
    created_by, updated_by
  ) VALUES (
    p_company_id, p_banco_codigo, p_provider, p_ambiente,
    p_client_id, v_clisec_id, v_cert_id, v_certpw_id, v_apikey_id,
    p_agencia, p_conta, p_cooperativa, p_posto, p_codigo_beneficiario, p_convenio, p_carteira,
    COALESCE(p_cap_extrato, false), COALESCE(p_cap_boleto, false), COALESCE(p_cap_pagamento, false),
    COALESCE(p_ativo, false),
    CASE WHEN v_cert_novo THEN p_cert_expira_em ELSE NULL END,
    CASE WHEN v_cert_novo THEN now() ELSE NULL END,
    p_juros_pct, p_multa_pct, p_dias_multa, p_dias_juros,
    p_instrucao_linha1, p_instrucao_linha2, p_instrucao_linha3, p_instrucao_linha4,
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
      -- encargos do boleto: COALESCE preserva o valor existente quando o parâmetro não veio (RD-57).
      juros_pct = COALESCE(p_juros_pct, public.erp_banco_provider_config.juros_pct),
      multa_pct = COALESCE(p_multa_pct, public.erp_banco_provider_config.multa_pct),
      dias_multa = COALESCE(p_dias_multa, public.erp_banco_provider_config.dias_multa),
      dias_juros = COALESCE(p_dias_juros, public.erp_banco_provider_config.dias_juros),
      instrucao_linha1 = COALESCE(p_instrucao_linha1, public.erp_banco_provider_config.instrucao_linha1),
      instrucao_linha2 = COALESCE(p_instrucao_linha2, public.erp_banco_provider_config.instrucao_linha2),
      instrucao_linha3 = COALESCE(p_instrucao_linha3, public.erp_banco_provider_config.instrucao_linha3),
      instrucao_linha4 = COALESCE(p_instrucao_linha4, public.erp_banco_provider_config.instrucao_linha4),
      updated_at = now(), updated_by = v_uid;

  RETURN jsonb_build_object('ok', true, 'client_secret_vault_id', v_clisec_id, 'cert_vault_id', v_cert_id,
    'cert_senha_vault_id', v_certpw_id, 'api_key_vault_id', v_apikey_id,
    'cert_expira_em', CASE WHEN v_cert_novo THEN p_cert_expira_em ELSE v_existing.cert_expira_em END);
END;
$function$;

-- Guardas (check-fn-guards): SECURITY DEFINER fechada ao anon; autoria por auth.uid() (mantida).
REVOKE ALL ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text, date,
  numeric, numeric, integer, integer, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_salvar_credencial(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, text, text, date,
  numeric, numeric, integer, integer, text, text, text, text) TO authenticated, service_role;
