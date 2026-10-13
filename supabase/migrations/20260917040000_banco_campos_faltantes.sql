-- ② (Jordana #88, rede geral) · aviso por PROVIDER na config bancária.
-- Decisão CEO: o aviso tem que ser POR PROVIDER e vir do dado, não de lista fixa — cada banco pede
-- coisas diferentes (Sicredi: coop/posto/beneficiário/api_key/código de acesso; Sicoob: +cert; Bradesco:
-- cert próprio). Um aviso genérico mandaria a pessoa procurar o que não existe (o erro do #88).
--
-- Esta função é a FONTE do aviso: compara os campos do erp_banco_manifesto[provider].campos com o que está
-- realmente preenchido em erp_banco_provider_config (colunas + referências de Vault *_vault_id) e devolve
-- os LABELS que faltam. Como só olha os campos que o manifesto lista para aquele provider, nunca acusa
-- algo que o banco não usa (ex.: certificado no Sicredi). Segredos são checados pela PRESENÇA do vault_id
-- (não expõe valor). Aviso, não trava: a tela mostra os faltantes mas deixa salvar (regra 0e580f96).

CREATE OR REPLACE FUNCTION public.fn_banco_campos_faltantes(p_company_id uuid, p_provider text, p_ambiente text DEFAULT 'producao')
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_campos jsonb;
  v_cfg    record;
  v_falta  text[] := ARRAY[]::text[];
  c        jsonb;
  v_id     text;
  v_label  text;
  v_ok     boolean;
BEGIN
  SELECT campos INTO v_campos FROM public.erp_banco_manifesto WHERE provider = p_provider;
  IF v_campos IS NULL THEN RETURN v_falta; END IF;  -- sem manifesto → não acusa nada

  SELECT * INTO v_cfg FROM public.erp_banco_provider_config
   WHERE company_id = p_company_id AND provider = p_provider AND ambiente = p_ambiente
   ORDER BY updated_at DESC LIMIT 1;

  FOR c IN SELECT * FROM jsonb_array_elements(v_campos) LOOP
    v_id    := c->>'id';
    v_label := COALESCE(c->>'label', v_id);
    -- presença por campo (segredos = presença do *_vault_id; nunca o valor)
    v_ok := CASE v_id
      WHEN 'cooperativa'         THEN COALESCE(NULLIF(btrim(v_cfg.cooperativa),''),'')          <> ''
      WHEN 'posto'               THEN COALESCE(NULLIF(btrim(v_cfg.posto),''),'')                <> ''
      WHEN 'codigo_beneficiario' THEN COALESCE(NULLIF(btrim(v_cfg.codigo_beneficiario),''),'')  <> ''
      WHEN 'conta'               THEN COALESCE(NULLIF(btrim(v_cfg.conta),''),'')                <> ''
      WHEN 'convenio'            THEN COALESCE(NULLIF(btrim(v_cfg.convenio),''),'')             <> ''
      WHEN 'carteira'            THEN COALESCE(NULLIF(btrim(v_cfg.carteira),''),'')             <> ''
      WHEN 'agencia'             THEN COALESCE(NULLIF(btrim(v_cfg.agencia),''),'')              <> ''
      WHEN 'client_id'           THEN COALESCE(NULLIF(btrim(v_cfg.client_id),''),'')            <> ''
      WHEN 'api_key'             THEN v_cfg.api_key_vault_id       IS NOT NULL
      WHEN 'codigo_acesso'       THEN v_cfg.client_secret_vault_id IS NOT NULL
      WHEN 'client_secret'       THEN v_cfg.client_secret_vault_id IS NOT NULL
      WHEN 'cert'                THEN v_cfg.cert_vault_id          IS NOT NULL
      WHEN 'certpw'              THEN v_cfg.cert_senha_vault_id    IS NOT NULL
      ELSE true  -- campo desconhecido → não acusa (não inventa exigência)
    END;
    IF v_cfg IS NULL THEN v_ok := false; END IF;  -- sem config nenhuma → tudo falta
    IF NOT v_ok THEN v_falta := array_append(v_falta, v_label); END IF;
  END LOOP;

  RETURN v_falta;
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_banco_campos_faltantes(uuid, text, text) TO authenticated, service_role;
