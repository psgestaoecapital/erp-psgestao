-- ============================================================
-- Migrar as senhas base64 para o Vault, in-place.
-- A senha NUNCA aparece em texto: sai da tabela, entra no Vault. Corrige o §4 do SPEC anterior
-- que dizia ser impossivel por SQL — a senha so vazaria se fosse DIGITADA no SQL; lida da propria
-- tabela para uma variavel, nao aparece no arquivo, nem no log, nem no retorno. Decisao do CEO:
-- "nao crie lugar novo para reenviar, proteja as que estao la gravadas." RD-26: mesmo padrao de
-- fn_certificado_senha_salvar (#1309) e fn_fiscal_salvar_token.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_certificado_senha_migrar_vault(
  p_certificado_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault'
AS $function$
DECLARE
  v_cert record; v_senha text; v_nome text; v_existing uuid; v_vault_id uuid;
  v_conferido text; v_migrados int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas administrador'); END IF;
  FOR v_cert IN
    SELECT id, company_id, senha_encrypted FROM erp_certificados_a1
     WHERE removido_em IS NULL
       AND senha_encrypted IS NOT NULL
       AND senha_vault_id IS NULL
       AND (p_certificado_id IS NULL OR id = p_certificado_id)
  LOOP
    BEGIN
      -- decodifica em variavel; nada disso aparece em log
      v_senha := convert_from(decode(v_cert.senha_encrypted,'base64'),'UTF8');
      IF v_senha IS NULL OR btrim(v_senha) = '' THEN
        v_erros := v_erros || jsonb_build_object(
          'certificado_id', v_cert.id, 'motivo', 'senha vazia apos decodificar');
        CONTINUE;
      END IF;
      v_nome := 'cert_a1_senha_' || v_cert.id::text;
      SELECT id INTO v_existing FROM vault.secrets WHERE name = v_nome;
      IF v_existing IS NOT NULL THEN
        PERFORM vault.update_secret(v_existing, v_senha); v_vault_id := v_existing;
      ELSE
        v_vault_id := vault.create_secret(v_senha, v_nome,
          'Senha do certificado A1 (cert ' || v_cert.id::text ||
          ' · company ' || v_cert.company_id::text || ') · migrada de base64 em ' ||
          to_char(now(),'DD/MM/YYYY'));
      END IF;
      -- CONFERE ANTES DE APAGAR: le de volta do Vault e compara
      SELECT decrypted_secret INTO v_conferido
        FROM vault.decrypted_secrets WHERE id = v_vault_id;
      IF v_conferido IS DISTINCT FROM v_senha THEN
        v_erros := v_erros || jsonb_build_object(
          'certificado_id', v_cert.id,
          'motivo', 'valor no Vault nao confere - senha NAO apagada');
        CONTINUE;
      END IF;
      -- so agora apaga a senha antiga
      UPDATE erp_certificados_a1
         SET senha_vault_id = v_vault_id, senha_migrada_em = now(),
             senha_encrypted = NULL, atualizado_em = now()
       WHERE id = v_cert.id;
      v_migrados := v_migrados + 1;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros || jsonb_build_object(
        'certificado_id', v_cert.id, 'motivo', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'migrados', v_migrados,
    'erros', v_erros, 'qtd_erros', jsonb_array_length(v_erros));
END $function$;
