-- Conserto da main (CEO 24/11): o #6080 criou fn_fiscal_iss_resolver (SECURITY DEFINER) sem o
-- REVOKE ... FROM anon, deixando o gate obrigatorio check_fn_guards VERMELHO (Regra 1 do
-- scripts/check-fn-guards.ts). Esta migration faz parte do mesmo conserto-main do #6090 (que
-- desduplica a 160030 + corrige o status do erp_ajuda_campo): sem o REVOKE o check_fn_guards
-- continua vermelho e a fila nao mergeia; sem a desduplicacao o check_migrations continua vermelho.
-- As duas correcoes TEM de vir no mesmo PR (uma destrava o check que a outra deixa vermelho).
--
-- RD-52: a migration do #6080 (20261126160020) ja esta na main; nao se edita arquivo ja registrado.
-- A regularizacao correta e uma migration MAIS NOVA com o REVOKE da mesma funcao (mecanismo
-- regularizaRevoke do check-fn-guards), que satisfaz o gate e remove de fato o privilegio do anon.
--
-- O CEO decidiu REVOKE (nao ci-allow-anon): a funcao tem guarda de empresa
-- (get_user_company_ids/is_admin) e nao e rota publica. Mantem o padrao do repo
-- (GRANT EXECUTE a authenticated + service_role).

REVOKE ALL ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) TO authenticated, service_role;
