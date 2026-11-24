-- conserto-main · regulariza check:fn-guards [revoke_anon]
-- A migration 20261126160020_fiscal_iss_resolver_global_fallback_seed_fcpisos_9427.sql recriou
-- public.fn_fiscal_iss_resolver (CREATE OR REPLACE, SECURITY DEFINER) SEM a linha REVOKE anon
-- exigida pela régua scripts/check-fn-guards.ts. Isso deixa o gate check_fn_guards VERMELHO em
-- TODA PR com migration re-rodada contra a main, travando a fila de merge (ex.: #6035, #6043).
--
-- PROVA RD-38 (produção, projeto horsymhsinqcimflrtjo):
--   public.fn_fiscal_iss_resolver(uuid,text,text,date) tem grants apenas a
--   postgres, service_role e authenticated — NENHUM grant a anon ou PUBLIC.
--   CREATE OR REPLACE preserva a ACL existente, então a função NUNCA ficou aberta ao anon:
--   não há furo de segurança real. Este arquivo apenas REGULARIZA o gate estático
--   (regularizaRevoke, scripts/check-fn-guards.ts) e é NO-OP sobre o dado.
--
-- Aditiva e idempotente: REVOKE só remove privilégio (não existe anon aqui) e o GRANT
-- reafirma exatamente o estado atual de produção. Não altera a lógica fiscal.

REVOKE ALL ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_iss_resolver(uuid, text, text, date) TO authenticated, service_role;
