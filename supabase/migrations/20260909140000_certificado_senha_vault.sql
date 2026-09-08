-- ============================================================
-- Seguranca · senha do certificado A1 sai da tabela e vai ao Vault
-- erp_certificados_a1.senha_encrypted era BASE64 (codificacao reversivel), nao criptografia — o
-- nome afirmava uma protecao que nao existia. A senha + o .pfx no bucket permitem assinar em nome
-- da empresa. A casa certa ja existe: fn_fiscal_salvar_token guarda o token da Focus no Vault e
-- deixa so a referencia (focus_token_vault_id). Aqui aplicamos ao certificado o MESMO padrao (RD-26).
-- ============================================================

-- 2.1 a referencia do segredo, ao lado do que ja existe
ALTER TABLE public.erp_certificados_a1
  ADD COLUMN IF NOT EXISTS senha_vault_id uuid,
  ADD COLUMN IF NOT EXISTS senha_migrada_em timestamptz;
COMMENT ON COLUMN public.erp_certificados_a1.senha_vault_id IS
  'Referencia ao segredo em vault.secrets com a senha do .pfx. Mesmo padrao de '
  'erp_fiscal_provider_config.focus_token_vault_id.';

-- 2.2 o nome antigo deixa de mentir
COMMENT ON COLUMN public.erp_certificados_a1.senha_encrypted IS
  'DEPRECIADO - o conteudo era base64, NAO criptografia. Substituido por senha_vault_id. '
  'Sera removido apos a migracao dos 6 certificados e a atualizacao dos consumidores.';

-- 2.3 gravar a senha no Vault (mesmo padrao do token da Focus)
CREATE OR REPLACE FUNCTION public.fn_certificado_senha_salvar(
  p_certificado_id uuid, p_senha text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault'
AS $function$
DECLARE v_cert record; v_uid uuid; v_nome text; v_existing uuid; v_vault_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  SELECT * INTO v_cert FROM erp_certificados_a1
   WHERE id = p_certificado_id AND removido_em IS NULL;
  IF v_cert.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'certificado_nao_encontrado'); END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies
                  WHERE user_id = v_uid AND company_id = v_cert.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa'); END IF;
  IF p_senha IS NULL OR btrim(p_senha) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'senha vazia'); END IF;
  v_nome := 'cert_a1_senha_' || p_certificado_id::text;
  SELECT id INTO v_existing FROM vault.secrets WHERE name = v_nome;
  IF v_existing IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing, btrim(p_senha)); v_vault_id := v_existing;
  ELSE
    v_vault_id := vault.create_secret(btrim(p_senha), v_nome,
      'Senha do certificado A1 (cert ' || p_certificado_id::text ||
      ' · company ' || v_cert.company_id::text || ')');
  END IF;
  UPDATE erp_certificados_a1
     SET senha_vault_id = v_vault_id, senha_migrada_em = now(),
         senha_encrypted = NULL, atualizado_em = now(), atualizado_por = v_uid
   WHERE id = p_certificado_id;
  RETURN jsonb_build_object('ok', true, 'vault_id', v_vault_id);
END $function$;
