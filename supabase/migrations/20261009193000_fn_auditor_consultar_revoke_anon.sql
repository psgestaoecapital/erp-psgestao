-- Hotfix (CEO 09/10): regulariza o check_fn_guards travado pela #2346.
-- A #2346 (20261009174300) fez CREATE OR REPLACE de fn_auditor_matriz_consultar sem repetir o REVOKE no arquivo, o que
-- reprova o check_fn_guards em TODA PR (a régua varre todas as migrations >= cutoff) e trava a fila de merge inteira.
-- A função já é só postgres/service_role no banco (anon nunca teve acesso); este REVOKE é IDEMPOTENTE e regulariza a
-- violação estática pela versão mais nova (mecanismo documentado em scripts/check-fn-guards.ts · regularizaRevoke).
REVOKE ALL ON FUNCTION public.fn_auditor_matriz_consultar(bigint) FROM PUBLIC, anon;
