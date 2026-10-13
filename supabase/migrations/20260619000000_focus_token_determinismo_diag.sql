-- focus-token-determinismo-diag · resolve causa raiz do 401 KGF
-- 1.1) fn_fiscal_obter_token: deterministico + respeita ambiente
--      desempate por atualizado_em DESC > criado_em DESC > id DESC.
-- 1.2) fn_fiscal_diag_token: jsonb com configs_ativas, config_escolhida,
--      token_prefixo(5) e token_tamanho (segredo nao volta).

CREATE OR REPLACE FUNCTION public.fn_fiscal_obter_token(p_company_id uuid, p_ambiente text DEFAULT 'producao')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','vault'
AS $function$
DECLARE
  v_vault_id uuid;
  v_token text;
BEGIN
  SELECT focus_token_vault_id INTO v_vault_id
    FROM erp_fiscal_provider_config
   WHERE company_id = p_company_id
     AND ativo = true
     AND lower(coalesce(ambiente,'producao')) = lower(p_ambiente)
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

CREATE OR REPLACE FUNCTION public.fn_fiscal_diag_token(p_company_id uuid, p_ambiente text DEFAULT 'producao')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','vault'
AS $function$
DECLARE
  v_cfg   record;
  v_token text;
  v_total int;
BEGIN
  SELECT count(*) INTO v_total
    FROM erp_fiscal_provider_config
   WHERE company_id = p_company_id AND ativo = true
     AND lower(coalesce(ambiente,'producao')) = lower(p_ambiente);

  SELECT id, provider, ambiente, focus_token_vault_id INTO v_cfg
    FROM erp_fiscal_provider_config
   WHERE company_id = p_company_id AND ativo = true
     AND lower(coalesce(ambiente,'producao')) = lower(p_ambiente)
   ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC NULLS LAST, id DESC
   LIMIT 1;

  IF v_cfg.focus_token_vault_id IS NULL THEN
    RETURN jsonb_build_object('erro','sem config ativa ou sem vault', 'configs_ativas', v_total);
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE id = v_cfg.focus_token_vault_id LIMIT 1;

  RETURN jsonb_build_object(
    'configs_ativas',   v_total,
    'config_escolhida', v_cfg.provider,
    'config_id',        v_cfg.id,
    'ambiente',         v_cfg.ambiente,
    'token_prefixo',    left(coalesce(v_token,''),5),
    'token_tamanho',    length(coalesce(v_token,'')),
    'token_presente',   (v_token IS NOT NULL AND v_token <> '')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fiscal_diag_token(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_diag_token(uuid,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_fiscal_obter_token(uuid,text) IS
'fiscal · deterministico · respeita p_ambiente, desempate por atualizado_em > criado_em > id.';
COMMENT ON FUNCTION public.fn_fiscal_diag_token(uuid,text) IS
'fiscal · diagnostico: configs_ativas + config_escolhida + token_prefixo(5) sem expor segredo.';
