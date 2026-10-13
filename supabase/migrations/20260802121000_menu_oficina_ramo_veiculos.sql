-- RD-41 · Oficina genérica — Fase 1 · Parte 5: esconder "Veículos" quando ramo≠automotiva.
-- Reusa o mecanismo EXISTENTE de menu (module_catalog.ramos_aplicaveis && ramos_da_empresa),
-- só estendendo `ramos_da_empresa` p/ enxergar o ramo da OFICINA (erp_oficina_parametros.ramo).
-- Vocabulário do oficina-ramo (automotiva/retifica/…) é disjunto do industrial (bovinos/…),
-- então some sem colidir. ADITIVO: só CREATE OR REPLACE + UPDATE de 1 linha. Regressão zero:
-- toda empresa que já usa a oficina cai em 'automotiva' (por parâmetro OU por ter OS), então
-- continua vendo Veículos como hoje. Só quem for explicitamente não-automotivo perde a tela.

-- 1 · ramos_da_empresa passa a unir o ramo da oficina. Fallback 'automotiva' p/ oficina ativa
--     sem linha de parâmetros (mantém Veículos visível — regressão zero).
CREATE OR REPLACE FUNCTION public.ramos_da_empresa(p_company_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND btrim(r) <> ''), ARRAY[]::text[])
  FROM (
    SELECT lower(btrim(c.industria_subtipo)) AS r FROM companies c WHERE c.id = p_company_id
    UNION
    SELECT lower(btrim(e)) FROM industrial_plants p, unnest(coalesce(p.especies, ARRAY[]::text[])) e
    WHERE p.company_id = p_company_id AND coalesce(p.is_active, true) = true
    UNION
    -- ramo da OFICINA: parâmetro explícito; senão 'automotiva' se a empresa tem OS (oficina ativa).
    SELECT COALESCE(
      (SELECT lower(btrim(op.ramo)) FROM erp_oficina_parametros op WHERE op.company_id = p_company_id),
      CASE WHEN EXISTS (SELECT 1 FROM erp_os o WHERE o.company_id = p_company_id) THEN 'automotiva' END
    )
  ) z;
$function$;
GRANT EXECUTE ON FUNCTION public.ramos_da_empresa(uuid) TO authenticated;

-- 2 · a tela "Veículos" passa a ser ESPECÍFICA do ramo automotiva (retífica não tem frota).
UPDATE public.module_catalog SET ramos_aplicaveis = ARRAY['automotiva']
WHERE id = 'oficina_veiculos_fipe';
