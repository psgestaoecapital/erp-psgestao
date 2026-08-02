-- RD-41 · Oficina genérica — Fase 1: config "ramo" da oficina.
-- O banco (RD-26) já é genérico (erp_os.placa/veiculo/km nullable). A "automotividade"
-- vive no frontend. Este `ramo` por empresa dirige labels/campos/telas — zero cirurgia
-- de schema, aditivo, config-driven. Empresas existentes → 'automotiva' (KGF).

ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS ramo text NOT NULL DEFAULT 'automotiva';

-- ramos suportados nesta fase (aditivo: novos ramos entram sem mexer no schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_oficina_parametros_ramo_check'
  ) THEN
    ALTER TABLE public.erp_oficina_parametros
      ADD CONSTRAINT erp_oficina_parametros_ramo_check
      CHECK (ramo IN ('automotiva','retifica','usinagem','eletrica','geral'));
  END IF;
END $$;

-- backfill explícito: quem já existe é automotiva (KGF).
UPDATE public.erp_oficina_parametros SET ramo = 'automotiva' WHERE ramo IS NULL;

-- RPC leve: o frontend descobre o ramo da empresa (default 'automotiva' se não houver
-- linha de parâmetros ainda). RLS por empresa. A retífica recebe 'retifica' no onboarding.
CREATE OR REPLACE FUNCTION public.fn_oficina_ramo(p_company_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ramo text;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN NULL;
  END IF;
  SELECT ramo INTO v_ramo FROM erp_oficina_parametros WHERE company_id = p_company_id;
  RETURN COALESCE(v_ramo, 'automotiva');
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_ramo(uuid) TO authenticated;
