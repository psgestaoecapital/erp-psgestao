-- Regularização (CEO 07/10): a migration 20261007200000_financeiro_views_filtram_excluidos.sql (#2168) recriou
-- fn_fluxo_caixa_diario (SECURITY DEFINER) sem repetir o REVOKE do anon no arquivo, e o check_fn_guards ficou vermelho
-- em todas as PRs. Em produção o anon já NÃO executa a função (o CREATE OR REPLACE manteve os privilégios antigos —
-- conferido no banco: has_function_privilege('anon', …) = false). Esta migration só reafirma os privilégios, de forma
-- idempotente: não muda o corpo da função nem nenhum dado. A régua (scripts/check-fn-guards.ts) aceita a regularização
-- por migration POSTERIOR — o arquivo já aplicado não é editado.
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) TO authenticated, service_role;
