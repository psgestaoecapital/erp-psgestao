-- check_fn_guards vermelho na main: 20261009174300 recriou fn_auditor_matriz_consultar (CREATE OR REPLACE) sem refazer o REVOKE de anon.
-- Só fecha o grant (sem mudar o corpo). A rotina interna roda como service_role/postgres.
REVOKE ALL ON FUNCTION public.fn_auditor_matriz_consultar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_matriz_consultar(bigint) TO authenticated, service_role;
