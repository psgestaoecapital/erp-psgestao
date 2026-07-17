-- FIX latente: fn_fiscal_salvar_token, no ramo INSERT (empresa sem config fiscal ativa),
-- criava a config com provider='gov_nfse_nacional' — mas a EMISSÃO NFS-e lê provider='focusnfe'.
-- Resultado: numa empresa nova, salvar o token criava uma config que a emissão nunca acha.
-- Correção: o INSERT passa a criar provider='focusnfe' (idêntico ao que a emissão lê).
-- Só troca a string do provider no INSERT; resto idêntico. Aditivo/reversível.
CREATE OR REPLACE FUNCTION public.fn_fiscal_salvar_token(p_company_id uuid, p_token text, p_ambiente text DEFAULT 'producao'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_vault_id uuid; v_secret_name text; v_existing_id uuid; v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN RETURN jsonb_build_object('ok', false, 'erro', 'token invalido'); END IF;
  IF p_ambiente NOT IN ('producao','homologacao') THEN RETURN jsonb_build_object('ok', false, 'erro', 'ambiente invalido'); END IF;
  v_secret_name := 'focus_token_' || CASE WHEN p_ambiente='producao' THEN 'prod' ELSE 'homolog' END || '_' || p_company_id::text;
  SELECT id INTO v_existing_id FROM vault.secrets WHERE name = v_secret_name;
  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, btrim(p_token)); v_vault_id := v_existing_id;
  ELSE
    v_vault_id := vault.create_secret(btrim(p_token), v_secret_name, 'Focus NFe ' || p_ambiente || ' token (company ' || p_company_id::text || ')');
  END IF;
  UPDATE erp_fiscal_provider_config SET focus_token_vault_id = v_vault_id, atualizado_em = now(), atualizado_por = v_uid
    WHERE company_id = p_company_id AND ativo = true;
  IF NOT FOUND THEN
    INSERT INTO erp_fiscal_provider_config (company_id, provider, ambiente, focus_token_vault_id, ativo, criado_por)
    VALUES (p_company_id, 'focusnfe', p_ambiente, v_vault_id, true, v_uid);  -- FIX: era 'gov_nfse_nacional'
  END IF;
  RETURN jsonb_build_object('ok', true, 'vault_id', v_vault_id);
END;
$function$;
