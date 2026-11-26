-- Chamado "Configuração Fiscal não persiste o Token da Focus" (163 · NF-e em homologação dá "api_key Focus NFe não encontrada").
--
-- CAUSA RAIZ (provada no dado, sem ler valor de token):
--  • O token SALVOU: o segredo focus_token_homolog_<empresa> está no Vault, atualizado em 24/11 12:40:11 UTC, e
--    focus_token_vault_id aponta para ele. (focus_token_secret_homolog/prod NULL é normal: são o mecanismo ANTIGO de
--    nome de variável de ambiente das edges, nada a ver com o cofre — não indicam falta de token.)
--  • O que falha é a LEITURA: fn_fiscal_obter_token(empresa, 'homologacao') só devolvia o token se a coluna `ambiente` da
--    config (o ambiente da empresa/NFS-e) fosse IGUAL ao ambiente pedido. A 163 está com ambiente = 'producao' (NFS-e) e
--    ambiente_nfe = 'homologacao' (NF-e, #5666): o emissor pede o token de homologação, a função procura uma config com
--    ambiente = 'homologacao', não acha → NULL → "api_key Focus NFe não encontrada". Nenhuma nota é gerada.
--  • Além disso o cadastro usava UM ponteiro só (focus_token_vault_id) para dois tokens: salvar o de produção depois do de
--    homologação (ou o contrário) trocava o ponteiro e o ambiente errado passava a "ver" o token do outro.
--  • Os "Salvar" seguintes não mudaram atualizado_em porque os campos de token ficam vazios depois do primeiro salvamento
--    ("deixe vazio para manter o atual") e a tela não mostrava, por ambiente, se o token está gravado — parecia perdido.
--
-- O QUE ESTA MIGRATION FAZ (nenhum token é lido, copiado ou apagado; nenhum dado de cliente é alterado):
--  1) fn_fiscal_obter_token: cada ambiente resolve o SEU segredo pelo nome (focus_token_{homolog|prod}_<empresa>), que é
--     como o cadastro grava; só se esse segredo não existir cai no ponteiro legado, com a regra antiga (ambiente da
--     config igual ao pedido — nunca entrega token de produção para homologação nem o contrário).
--  2) fn_fiscal_salvar_token: o ponteiro legado só muda quando o token salvo é o do ambiente da config (ou se ainda não
--     havia ponteiro); salvar o token de um ambiente nunca mais "rouba" o do outro. Sempre carimba atualizado_em/por.
--  3) fn_fiscal_token_status: diz, por ambiente, se há token gravado e quando (só nome e data do segredo, nunca o valor)
--     — a tela passa a mostrar "✓ gravado em dd/mm hh:mm" para cada token.
-- Assinaturas e ACL preservadas (fn_fiscal_obter_token segue só service_role).

-- 1) leitura por ambiente ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fiscal_obter_token(p_company_id uuid, p_ambiente text DEFAULT 'producao'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_vault_id uuid;
  v_token text;
  v_amb text := lower(coalesce(nullif(btrim(p_ambiente), ''), 'producao'));
BEGIN
  -- só empresa com configuração fiscal ativa
  IF NOT EXISTS (SELECT 1 FROM erp_fiscal_provider_config WHERE company_id = p_company_id AND ativo = true) THEN
    RETURN NULL;
  END IF;

  -- 1) o token DESTE ambiente, pelo nome do segredo (como fn_fiscal_salvar_token grava)
  IF v_amb IN ('producao', 'homologacao') THEN
    SELECT decrypted_secret INTO v_token
      FROM vault.decrypted_secrets
     WHERE name = 'focus_token_' || CASE WHEN v_amb = 'producao' THEN 'prod' ELSE 'homolog' END || '_' || p_company_id::text
     LIMIT 1;
    IF v_token IS NOT NULL AND length(btrim(v_token)) >= 8 THEN
      RETURN v_token;
    END IF;
  END IF;

  -- 2) legado: ponteiro único, só quando o ambiente da config é o pedido (sem trocar token de ambiente)
  SELECT focus_token_vault_id INTO v_vault_id
    FROM erp_fiscal_provider_config
   WHERE company_id = p_company_id
     AND ativo = true
     AND lower(coalesce(ambiente,'producao')) = v_amb
   ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST, id DESC
   LIMIT 1;

  IF v_vault_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE id = v_vault_id
   LIMIT 1;

  RETURN v_token;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_fiscal_obter_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_obter_token(uuid, text) TO service_role;

-- 2) gravação: cada ambiente no seu segredo; o ponteiro legado não é mais trocado pelo token do outro ambiente --------------
-- ci-sem-guarda: fn_fiscal_salvar_token — o acesso é conferido na própria função (auth.uid() precisa estar em
-- user_companies da empresa), igual à versão anterior; só o tratamento do ponteiro legado muda.
CREATE OR REPLACE FUNCTION public.fn_fiscal_salvar_token(p_company_id uuid, p_token text, p_ambiente text DEFAULT 'producao'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
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
  -- o ponteiro legado só vai para este segredo se ainda não havia um, ou se este é o ambiente da config
  UPDATE erp_fiscal_provider_config SET
      focus_token_vault_id = CASE WHEN focus_token_vault_id IS NULL OR lower(coalesce(ambiente,'producao')) = p_ambiente
                                  THEN v_vault_id ELSE focus_token_vault_id END,
      atualizado_em = now(), atualizado_por = v_uid
    WHERE company_id = p_company_id AND ativo = true;
  IF NOT FOUND THEN
    INSERT INTO erp_fiscal_provider_config (company_id, provider, ambiente, focus_token_vault_id, ativo, criado_por)
    VALUES (p_company_id, 'focusnfe', p_ambiente, v_vault_id, true, v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'vault_id', v_vault_id, 'ambiente', p_ambiente);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_fiscal_salvar_token(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_salvar_token(uuid, text, text) TO authenticated, service_role;

-- 3) estado dos tokens por ambiente (só existência e data; o valor nunca sai do cofre) --------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fiscal_token_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_h timestamptz; v_p timestamptz; v_hok boolean; v_pok boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'autenticacao requerida'); END IF;
  IF NOT (EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;
  SELECT true, coalesce(updated_at, created_at) INTO v_hok, v_h FROM vault.secrets WHERE name = 'focus_token_homolog_' || p_company_id::text LIMIT 1;
  SELECT true, coalesce(updated_at, created_at) INTO v_pok, v_p FROM vault.secrets WHERE name = 'focus_token_prod_' || p_company_id::text LIMIT 1;
  RETURN jsonb_build_object('ok', true,
    'homologacao', jsonb_build_object('configurado', coalesce(v_hok, false), 'atualizado_em', v_h),
    'producao', jsonb_build_object('configurado', coalesce(v_pok, false), 'atualizado_em', v_p));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_fiscal_token_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_token_status(uuid) TO authenticated, service_role;
