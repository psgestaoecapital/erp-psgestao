-- /api/saude (CEO 05/10): ping leve só-leitura para o monitor de queda. Sem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_saude_ping()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT true $$;

REVOKE ALL ON FUNCTION public.fn_saude_ping() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_saude_ping() TO anon, authenticated, service_role;
