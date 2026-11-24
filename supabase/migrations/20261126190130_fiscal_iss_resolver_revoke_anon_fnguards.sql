-- Fecha public.fn_fiscal_iss_resolver ao anon (régua check-fn-guards · regra revoke_anon) — ADITIVO.
--
-- A função SECURITY DEFINER criada no #9427 (20261126160020_fiscal_iss_resolver_global_fallback_seed_fcpisos_9427.sql)
-- ficou sem REVOKE, então herdou o EXECUTE para PUBLIC (default do Postgres) — anon podia chamá-la por RPC direto (IDOR).
-- O check-fn-guards reprova ("sem REVOKE ALL ON FUNCTION ... FROM anon"), deixando o check vermelho em várias PRs.
--
-- Conserto SEM tocar no arquivo do autor: uma migration MAIS NOVA com o REVOKE regulariza a violação da anterior
-- (scripts/check-fn-guards.ts · filtrarRegularizadas/regularizaRevoke). Idempotente (REVOKE/GRANT podem re-rodar).
-- Versão > 20261126160020: roda depois que a função já existe no deploy em ordem.
REVOKE ALL ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) TO authenticated, service_role;
