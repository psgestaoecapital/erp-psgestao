-- Normaliza ramos no vocab controlado (RD-52: duas grafias p/ a mesma coisa é bug esperando).
-- Origem: Frioeste tinha ["bovino","bovinos"] (singular + plural) → resolvia p/ 2 valores da MESMA coisa.
-- NÃO altera a origem (companies.industria_subtipo / industrial_plants.especies) — só o RETORNO da função.
-- Aditivo (RD-55): helper novo + CREATE OR REPLACE. Reverter: restaurar ramos_da_empresa da #718 + DROP helper.
-- RD-53 PROVADO: baseline 40 combos (Frioeste/KGF/PS Gestão/Tryo × 10 áreas) → 0 divergências após aplicar.
--   Frioeste passa de ["bovino","bovinos"] p/ ["bovinos"]; filtro segue mordendo certo (Frioeste=true, resto=false).

-- Helper: 1 valor cru -> forma canônica (sem acento + singular->plural do vocab controlado).
CREATE OR REPLACE FUNCTION public.fn_normalizar_ramo(p_raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE v
    WHEN 'bovino'    THEN 'bovinos'    WHEN 'suino'     THEN 'suinos'
    WHEN 'ave'       THEN 'aves'       WHEN 'frango'    THEN 'aves'
    WHEN 'peixe'     THEN 'pescado'    WHEN 'pescados'  THEN 'pescado'
    WHEN 'laticinio' THEN 'laticinios' WHEN 'embutido'  THEN 'embutidos'
    WHEN 'conserva'  THEN 'conservas'  WHEN 'bebida'    THEN 'bebidas'
    WHEN 'grao'      THEN 'graos'      WHEN 'cereal'    THEN 'graos'
    WHEN 'plastico'  THEN 'plasticos'  WHEN 'movel'     THEN 'moveis'
    WHEN 'textil'    THEN 'texteis'
    ELSE v
  END
  FROM (SELECT lower(btrim(translate(
    coalesce(p_raw,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))) AS v) z;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_normalizar_ramo(text) TO authenticated;

-- ramos_da_empresa: aplica o normalizador a cada valor cru antes do DISTINCT (colapsa grafias).
CREATE OR REPLACE FUNCTION public.ramos_da_empresa(p_company_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND r <> ''), ARRAY[]::text[])
  FROM (
    SELECT public.fn_normalizar_ramo(c.industria_subtipo) AS r FROM companies c WHERE c.id = p_company_id
    UNION
    SELECT public.fn_normalizar_ramo(e) FROM industrial_plants p, unnest(coalesce(p.especies, ARRAY[]::text[])) e
    WHERE p.company_id = p_company_id AND coalesce(p.is_active, true) = true
  ) z;
$function$;
GRANT EXECUTE ON FUNCTION public.ramos_da_empresa(uuid) TO authenticated;
