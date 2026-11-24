-- Conserto da main (CEO 24/11): o #6080 criou fn_fiscal_iss_resolver (SECURITY DEFINER) sem o
-- REVOKE ... FROM anon, deixando o gate obrigatorio check_fn_guards VERMELHO na main (Regra 1 do
-- scripts/check-fn-guards.ts) e travando a fila.
--
-- RD-52: a migration do #6080 (20261126160020) ja esta mergeada na main; nao se edita arquivo ja
-- registrado (o db push nao reaplica). A regularizacao correta e uma migration MAIS NOVA com o REVOKE
-- da mesma funcao (mecanismo regularizaRevoke/filtrarRegularizadas do proprio check-fn-guards), que
-- (a) satisfaz o gate estatico e (b) remove de fato o privilegio do anon em producao.
--
-- Funcao: STABLE SECURITY DEFINER, so leitura, com guarda de empresa (get_user_company_ids/is_admin).
-- Fecha o IDOR por RPC direta do anon; mantem o padrao do repo (GRANT a authenticated + service_role).

REVOKE ALL ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) TO authenticated, service_role;
