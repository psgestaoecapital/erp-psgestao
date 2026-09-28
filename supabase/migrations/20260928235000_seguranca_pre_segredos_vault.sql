-- 🚨 SEGURANÇA · PR E (CEO 28/09) — segredos fora de coluna de texto; o logado da empresa não lê nenhum deles.
--
-- Achado: companies (e a view companies_producao, que é a mesma linha) guardava omie_app_key/omie_app_secret de 6
-- empresas e nibo_api_key/nibo_api_secret de 1, em texto. Qualquer logado da empresa lia (select * na tela
-- Conectores). E 2 certificados A1 guardavam a senha em base64 (= texto) em erp_certificados_a1.senha_encrypted —
-- e a rota de upload seguia gravando assim todo certificado novo.
--
-- O que muda:
-- (1) fn_credencial_empresa_ler(provider, chave, empresa): lê do Vault (erp_credencial → vault.decrypted_secrets).
--     Só serviço executa (as funções de sync rodam como dono e a chamam por dentro); nunca o logado nem o anon.
-- (2) As 8 funções de sync/outbox/teste do Omie deixam de ler a coluna e passam a ler do Vault.
-- (3) Cópia coluna → Vault (mesma convenção de nome do Cofre, fn_credencial_nome) para quem ainda não tem;
--     CONFERE lendo de volta do Vault (igualdade no banco, valor nunca sai) antes de limpar a coluna.
--     Se o Vault já tinha a credencial (salva pela tela), ela vale — é a mais nova.
-- (4) Colunas limpas (NULL) em companies; trigger impede gravar segredo nelas de novo.
-- (5) Certificados: as 2 senhas base64 vão para o Vault (conferidas, depois limpas); funções de serviço para a rota
--     de upload gravar direto no Vault e para a verificação de leitura ler do Vault.

-- ── (1) leitura do Vault por empresa ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_credencial_empresa_ler(p_provider text, p_chave text, p_company_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_nome text; v_val text;
BEGIN
  SELECT nome_secret_vault INTO v_nome FROM public.erp_credencial
   WHERE provider = p_provider AND chave = p_chave AND escopo = 'empresa' AND company_id = p_company_id AND ativo
   LIMIT 1;
  IF v_nome IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_val FROM vault.decrypted_secrets WHERE name = v_nome;
  RETURN NULLIF(v_val, '');
END $function$;
REVOKE ALL ON FUNCTION public.fn_credencial_empresa_ler(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_credencial_empresa_ler(text,text,uuid) TO service_role;

-- gravação pelo servidor (ex.: callback OAuth do ContaAzul) — só serviço; mesma convenção do Cofre
CREATE OR REPLACE FUNCTION public.fn_credencial_empresa_gravar_servico(p_provider text, p_chave text, p_valor text, p_company_id uuid, p_label text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_nome text; v_sid uuid;
BEGIN
  IF p_provider IS NULL OR p_chave IS NULL OR p_company_id IS NULL OR COALESCE(p_valor,'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'campos_obrigatorios');
  END IF;
  v_nome := public.fn_credencial_nome(p_provider, p_chave, 'empresa', p_company_id);
  SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
  IF v_sid IS NULL THEN PERFORM vault.create_secret(p_valor, v_nome, 'cofre:' || p_provider);
  ELSE PERFORM vault.update_secret(v_sid, p_valor); END IF;
  INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label, atualizado_em, ativo)
  VALUES (p_provider, p_chave, 'empresa', p_company_id, v_nome, p_label, now(), true)
  ON CONFLICT (provider, chave, escopo, (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET nome_secret_vault = EXCLUDED.nome_secret_vault, label = COALESCE(EXCLUDED.label, public.erp_credencial.label),
                atualizado_em = now(), ativo = true;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_credencial_empresa_gravar_servico(text,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_credencial_empresa_gravar_servico(text,text,text,uuid,text) TO service_role;

-- ── (3) cópia coluna → Vault, conferida ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record; it record; v_atual text; v_nome text; v_sid uuid; v_copiados int := 0; v_ja int := 0; v_diverge int := 0;
BEGIN
  FOR r IN SELECT id, omie_app_key, omie_app_secret, nibo_api_key, nibo_api_secret FROM public.companies
            WHERE COALESCE(omie_app_key, omie_app_secret, nibo_api_key, nibo_api_secret, '') <> '' LOOP
    FOR it IN SELECT * FROM (VALUES
        ('omie','app_key',r.omie_app_key), ('omie','app_secret',r.omie_app_secret),
        ('nibo','api_key',r.nibo_api_key), ('nibo','api_secret',r.nibo_api_secret)) v(provider, chave, valor)
       WHERE COALESCE(v.valor,'') <> '' LOOP
      v_atual := public.fn_credencial_empresa_ler(it.provider, it.chave, r.id);
      IF v_atual IS NOT NULL THEN
        IF v_atual = it.valor THEN v_ja := v_ja + 1; ELSE v_diverge := v_diverge + 1; END IF;   -- Vault vale (mais novo)
        CONTINUE;
      END IF;
      v_nome := public.fn_credencial_nome(it.provider, it.chave, 'empresa', r.id);
      SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
      IF v_sid IS NULL THEN PERFORM vault.create_secret(it.valor, v_nome, 'cofre:' || it.provider || ' · migrado de companies (PR E 28/09)');
      ELSE PERFORM vault.update_secret(v_sid, it.valor); END IF;
      INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label, atualizado_em, ativo)
      VALUES (it.provider, it.chave, 'empresa', r.id, v_nome, initcap(it.provider) || ' · ' || it.chave || ' (migrado)', now(), true)
      ON CONFLICT (provider, chave, escopo, (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      DO UPDATE SET nome_secret_vault = EXCLUDED.nome_secret_vault, atualizado_em = now(), ativo = true;
      IF public.fn_credencial_empresa_ler(it.provider, it.chave, r.id) IS DISTINCT FROM it.valor THEN
        RAISE EXCEPTION 'PR E: Vault não confere para %.% da empresa % — nada foi limpo', it.provider, it.chave, r.id;
      END IF;
      v_copiados := v_copiados + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PR E: % credenciais copiadas para o Vault, % já estavam iguais, % divergentes (Vault mantido)', v_copiados, v_ja, v_diverge;

  -- todas as empresas com coluna preenchida têm de ler do Vault antes de limpar
  IF EXISTS (SELECT 1 FROM public.companies c WHERE
       (COALESCE(c.omie_app_secret,'') <> '' AND public.fn_credencial_empresa_ler('omie','app_secret',c.id) IS NULL)
    OR (COALESCE(c.omie_app_key,'')    <> '' AND public.fn_credencial_empresa_ler('omie','app_key',c.id) IS NULL)
    OR (COALESCE(c.nibo_api_key,'')    <> '' AND public.fn_credencial_empresa_ler('nibo','api_key',c.id) IS NULL)
    OR (COALESCE(c.nibo_api_secret,'') <> '' AND public.fn_credencial_empresa_ler('nibo','api_secret',c.id) IS NULL)) THEN
    RAISE EXCEPTION 'PR E: há empresa com segredo na coluna e sem Vault — nada foi limpo';
  END IF;
END $$;

-- ── (2) as 8 funções do Omie leem do Vault ───────────────────────────────────────────────────────────────────
DO $$
DECLARE f text; v_def text; v_n int := 0;
BEGIN
  FOREACH f IN ARRAY ARRAY['fn_omie_sync_empresa','fn_outbox_omie_dispatch','fn_omie_sync_etapa','fn_omie_test_consulta',
                           'fn_outbox_omie_processar','fn_sync_produtos_empresa','fn_omie_validar_credenciais_e_lancamento','fn_sync_empresa'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f;
    IF v_def IS NULL THEN RAISE EXCEPTION 'PR E: função % não encontrada', f; END IF;
    IF v_def ~ 'fn_credencial_empresa_ler' THEN CONTINUE; END IF;
    v_def := replace(v_def, 'SELECT omie_app_key, omie_app_secret',
      $r$SELECT public.fn_credencial_empresa_ler('omie','app_key',id), public.fn_credencial_empresa_ler('omie','app_secret',id)$r$);
    IF v_def !~ 'fn_credencial_empresa_ler' OR v_def ~ 'omie_app_secret' THEN
      RAISE EXCEPTION 'PR E: % ainda lê a coluna depois da troca', f;
    END IF;
    EXECUTE v_def; v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'PR E: % funções do Omie passaram a ler do Vault', v_n;
END $$;

-- ── (4) limpa as colunas e impede gravar segredo nelas de novo ──────────────────────────────────────────────
UPDATE public.companies SET omie_app_key = NULL, omie_app_secret = NULL, nibo_api_key = NULL, nibo_api_secret = NULL,
  contaazul_token = NULL, contaazul_refresh_token = NULL, contaazul_client_secret = NULL
WHERE COALESCE(omie_app_key, omie_app_secret, nibo_api_key, nibo_api_secret, contaazul_token, contaazul_refresh_token, contaazul_client_secret, '') <> '';

CREATE OR REPLACE FUNCTION public.fn_companies_bloquear_segredo()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(NEW.omie_app_key, NEW.omie_app_secret, NEW.nibo_api_key, NEW.nibo_api_secret,
              NEW.contaazul_token, NEW.contaazul_refresh_token, NEW.contaazul_client_secret, '') <> '' THEN
    RAISE EXCEPTION 'Segredo de integração não vai em companies: salve pelo Cofre (Conectores).' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_companies_bloquear_segredo ON public.companies;
CREATE TRIGGER trg_companies_bloquear_segredo BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_bloquear_segredo();

-- ── (5) certificados A1: senha só no Vault ───────────────────────────────────────────────────────────────────
DO $$
DECLARE v_cert record; v_senha text; v_nome text; v_sid uuid; v_conf text; v_n int := 0;
BEGIN
  FOR v_cert IN SELECT id, company_id, senha_encrypted FROM public.erp_certificados_a1
                 WHERE COALESCE(senha_encrypted,'') <> '' AND senha_vault_id IS NULL LOOP
    v_senha := convert_from(decode(v_cert.senha_encrypted, 'base64'), 'UTF8');
    IF COALESCE(btrim(v_senha),'') = '' THEN RAISE EXCEPTION 'PR E: certificado % com senha vazia após decodificar', v_cert.id; END IF;
    v_nome := 'cert_a1_senha_' || v_cert.id::text;
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
    IF v_sid IS NULL THEN
      v_sid := vault.create_secret(v_senha, v_nome, 'Senha do certificado A1 (cert ' || v_cert.id || ' · company ' || v_cert.company_id || ') · PR E 28/09');
    ELSE PERFORM vault.update_secret(v_sid, v_senha); END IF;
    SELECT decrypted_secret INTO v_conf FROM vault.decrypted_secrets WHERE id = v_sid;
    IF v_conf IS DISTINCT FROM v_senha THEN RAISE EXCEPTION 'PR E: Vault não confere para o certificado % — nada foi limpo', v_cert.id; END IF;
    UPDATE public.erp_certificados_a1 SET senha_vault_id = v_sid, senha_migrada_em = now(), senha_encrypted = NULL, atualizado_em = now()
     WHERE id = v_cert.id;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'PR E: % senhas de certificado migradas para o Vault', v_n;
END $$;

-- gravação/leitura pelo servidor (rota de upload e verificação de leitura) — só serviço
CREATE OR REPLACE FUNCTION public.fn_certificado_senha_gravar_servico(p_certificado_id uuid, p_senha text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_cert record; v_nome text; v_sid uuid; v_conf text;
BEGIN
  SELECT id, company_id INTO v_cert FROM public.erp_certificados_a1 WHERE id = p_certificado_id AND removido_em IS NULL;
  IF v_cert.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'certificado_nao_encontrado'); END IF;
  IF COALESCE(btrim(p_senha),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'senha vazia'); END IF;
  v_nome := 'cert_a1_senha_' || p_certificado_id::text;
  SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
  IF v_sid IS NULL THEN
    v_sid := vault.create_secret(p_senha, v_nome, 'Senha do certificado A1 (cert ' || p_certificado_id || ' · company ' || v_cert.company_id || ')');
  ELSE PERFORM vault.update_secret(v_sid, p_senha); END IF;
  SELECT decrypted_secret INTO v_conf FROM vault.decrypted_secrets WHERE id = v_sid;
  IF v_conf IS DISTINCT FROM p_senha THEN RETURN jsonb_build_object('ok', false, 'erro', 'vault_nao_confere'); END IF;
  UPDATE public.erp_certificados_a1 SET senha_vault_id = v_sid, senha_migrada_em = now(), senha_encrypted = NULL, atualizado_em = now()
   WHERE id = p_certificado_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_certificado_senha_gravar_servico(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_certificado_senha_gravar_servico(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_certificado_senha_ler_servico(p_certificado_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_sid uuid; v_val text;
BEGIN
  SELECT senha_vault_id INTO v_sid FROM public.erp_certificados_a1 WHERE id = p_certificado_id;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_val FROM vault.decrypted_secrets WHERE id = v_sid;
  RETURN v_val;
END $function$;
REVOKE ALL ON FUNCTION public.fn_certificado_senha_ler_servico(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_certificado_senha_ler_servico(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_certificados_bloquear_senha_texto()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(NEW.senha_encrypted, '') <> '' THEN
    RAISE EXCEPTION 'Senha de certificado não vai em texto: use o Vault (fn_certificado_senha_gravar_servico).' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_certificados_bloquear_senha_texto ON public.erp_certificados_a1;
CREATE TRIGGER trg_certificados_bloquear_senha_texto BEFORE INSERT OR UPDATE ON public.erp_certificados_a1
  FOR EACH ROW EXECUTE FUNCTION public.fn_certificados_bloquear_senha_texto();

-- guarda final
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE COALESCE(omie_app_key, omie_app_secret, nibo_api_key, nibo_api_secret,
             contaazul_token, contaazul_refresh_token, contaazul_client_secret, '') <> '') THEN
    RAISE EXCEPTION 'PR E: ainda há segredo em companies';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_certificados_a1 WHERE COALESCE(senha_encrypted,'') <> '') THEN
    RAISE EXCEPTION 'PR E: ainda há senha de certificado em texto';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'SELECT omie_app_key, omie_app_secret') THEN
    RAISE EXCEPTION 'PR E: ainda há função lendo o segredo do Omie na coluna';
  END IF;
END $$;
