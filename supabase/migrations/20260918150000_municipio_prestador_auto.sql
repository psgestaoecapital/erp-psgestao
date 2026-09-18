-- NFS-e — código do município do prestador AUTOMÁTICO (o CEO: "devia sair do endereço, como o CEP").
--
-- Contexto (#90): a emissão da R.R travou em "parametro prestador.codigo_municipio nao informado"
-- porque gov_nfse_municipio_codigo estava NULL na config fiscal. É derivável do endereço da empresa
-- (companies.cidade_estado) contra o cadastro oficial de municípios (erp_gov_nfse_municipios).
--
-- fn_derivar_municipio_ibge: "Cidade, UF" | "Cidade/UF" -> codigo_ibge, acento- e caixa-insensível
-- (unaccent). Cidade desconhecida ou formato irreconhecível -> NULL (nunca inventa).
CREATE OR REPLACE FUNCTION public.fn_derivar_municipio_ibge(p_cidade_estado text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text;
  v_uf   text;
  v_m    text[];
  v_cod  text;
BEGIN
  IF p_cidade_estado IS NULL OR btrim(p_cidade_estado) = '' THEN
    RETURN NULL;
  END IF;
  v_m := regexp_match(p_cidade_estado, '^\s*(.+?)\s*[,/]\s*([A-Za-z]{2})\s*$');
  IF v_m IS NULL THEN
    RETURN NULL;
  END IF;
  v_nome := v_m[1];
  v_uf   := upper(v_m[2]);
  SELECT codigo_ibge INTO v_cod
  FROM public.erp_gov_nfse_municipios
  WHERE upper(uf) = v_uf
    AND unaccent(lower(nome_municipio)) = unaccent(lower(btrim(v_nome)))
  ORDER BY aderido DESC NULLS LAST
  LIMIT 1;
  RETURN v_cod;
END
$function$;

-- Trigger: ao salvar a config fiscal, se o código do município vier vazio, deriva do endereço da
-- empresa. Nunca sobrescreve valor já informado. Assim, nenhuma empresa nova cai no erro do #90.
CREATE OR REPLACE FUNCTION public.fn_config_fiscal_autopreenche_municipio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.gov_nfse_municipio_codigo IS NULL OR btrim(NEW.gov_nfse_municipio_codigo) = '' THEN
    SELECT public.fn_derivar_municipio_ibge(c.cidade_estado)
      INTO NEW.gov_nfse_municipio_codigo
    FROM public.companies c
    WHERE c.id = NEW.company_id;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_config_fiscal_autopreenche_municipio ON public.erp_fiscal_provider_config;
CREATE TRIGGER trg_config_fiscal_autopreenche_municipio
  BEFORE INSERT OR UPDATE ON public.erp_fiscal_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_config_fiscal_autopreenche_municipio();

-- Backfill: preenche qualquer config que ainda esteja sem código, derivando do endereço.
-- (Idempotente; hoje já não há NULL, mas garante o passado e futuras cargas.)
UPDATE public.erp_fiscal_provider_config fpc
SET gov_nfse_municipio_codigo = public.fn_derivar_municipio_ibge(c.cidade_estado)
FROM public.companies c
WHERE c.id = fpc.company_id
  AND (fpc.gov_nfse_municipio_codigo IS NULL OR btrim(fpc.gov_nfse_municipio_codigo) = '')
  AND public.fn_derivar_municipio_ibge(c.cidade_estado) IS NOT NULL;
