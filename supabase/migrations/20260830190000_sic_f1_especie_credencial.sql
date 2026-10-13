-- SIC-F1 · expõe especie_documento na credencial. ADITIVO: só acrescenta UMA chave ao JSON de
-- fn_banco_obter_credencial. 🧊 Sicoob (756) NÃO é tocado — nenhum caminho Sicoob lê especie_documento
-- da credencial (só a rota Sicredi lê), e `undefined` e `NULL` caem no mesmo fallback MERCANTIL do conector.
-- Sem isso, a rota Sicredi lia credRow.especie_documento SEMPRE undefined → todo boleto ia MERCANTIL,
-- inclusive a KGF (serviço = DUPLICATA_SERVICO_INDICACAO). Isso seria falsa precisão (RD-51/58).

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
    'nu_negociacao', c.nu_negociacao, 'juros_pct', c.juros_pct, 'multa_pct', c.multa_pct,
    'instrucao_linha1', c.instrucao_linha1, 'instrucao_linha2', c.instrucao_linha2,
    'instrucao_linha3', c.instrucao_linha3, 'instrucao_linha4', c.instrucao_linha4,
    'cap_extrato', c.cap_extrato, 'cap_boleto', c.cap_boleto, 'cap_pagamento', c.cap_pagamento,
    'especie_documento', c.especie_documento,   -- ADITIVO (SIC-F1): rota Sicredi usa; Sicoob ignora
    'cursor_extrato', c.cursor_extrato);
END;
$function$;
