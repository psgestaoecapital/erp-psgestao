-- Chamado #5404 (FC Pisos) · parte (b): boleto do Banco do Brasil (Cobrança v2) em HOMOLOGAÇÃO.
-- O BB exige, além de convênio e carteira, a VARIAÇÃO da carteira e a MODALIDADE (1 simples / 4 vinculada).
-- Cada ambiente é uma linha própria de erp_banco_provider_config (UNIQUE company+banco+ambiente): os dados de teste
-- da homologação não tocam os de produção. Colunas NOVAS e nulas (aditivo, sem UPDATE em dado de cliente).
-- Revisão: CREATE OR REPLACE de 2 funções SECURITY DEFINER (corpo vivo conferido: md5 prosrc
-- fn_banco_obter_credencial = 6a2ab4b974e836f78db5be328037e80a; fn_banco_config_salvar_cnab = 465aa83c1e56fa4c68a4c9337cae921f).
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS variacao_carteira text,
  ADD COLUMN IF NOT EXISTS modalidade_boleto text;

CREATE OR REPLACE FUNCTION public.fn_banco_obter_credencial(p_company_id uuid, p_banco_codigo text, p_ambiente text DEFAULT 'producao'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
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
    'agencia', c.agencia, 'conta', c.conta, 'cooperativa', c.cooperativa, 'posto', c.posto,
    'codigo_beneficiario', c.codigo_beneficiario, 'convenio', c.convenio, 'carteira', c.carteira,
    'variacao_carteira', c.variacao_carteira, 'modalidade_boleto', c.modalidade_boleto,
    'nu_negociacao', c.nu_negociacao, 'juros_pct', c.juros_pct, 'multa_pct', c.multa_pct,
    'instrucao_linha1', c.instrucao_linha1, 'instrucao_linha2', c.instrucao_linha2,
    'instrucao_linha3', c.instrucao_linha3, 'instrucao_linha4', c.instrucao_linha4,
    'cap_extrato', c.cap_extrato, 'cap_boleto', c.cap_boleto, 'cap_pagamento', c.cap_pagamento,
    'especie_documento', c.especie_documento,
    'cursor_extrato', c.cursor_extrato);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_banco_config_salvar_cnab(p_company_id uuid, p_config_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;

  UPDATE erp_banco_provider_config SET
    agencia            = COALESCE(NULLIF(p_dados->>'agencia',''), agencia),
    agencia_dv         = COALESCE(NULLIF(p_dados->>'agencia_dv',''), agencia_dv),
    conta              = COALESCE(NULLIF(p_dados->>'conta',''), conta),
    cooperativa        = COALESCE(NULLIF(p_dados->>'cooperativa',''), cooperativa),
    posto              = COALESCE(NULLIF(p_dados->>'posto',''), posto),
    codigo_beneficiario= COALESCE(NULLIF(p_dados->>'codigo_beneficiario',''), codigo_beneficiario),
    convenio           = COALESCE(NULLIF(p_dados->>'convenio',''), convenio),
    carteira           = COALESCE(NULLIF(p_dados->>'carteira',''), carteira),
    variacao_carteira  = COALESCE(NULLIF(p_dados->>'variacao_carteira',''), variacao_carteira),
    modalidade_boleto  = COALESCE(NULLIF(p_dados->>'modalidade_boleto',''), modalidade_boleto),
    updated_at = now()
  WHERE id = p_config_id AND company_id = p_company_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','config_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- Guarda de funções (check:fn-guards): formaliza o estado vivo (anon/PUBLIC já sem EXECUTE).
REVOKE ALL ON FUNCTION public.fn_banco_obter_credencial(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_obter_credencial(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_banco_config_salvar_cnab(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_banco_config_salvar_cnab(uuid, uuid, jsonb) TO authenticated, service_role;
