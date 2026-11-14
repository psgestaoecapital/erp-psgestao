-- conserto-main (gilberto-esteira) — portão/@pos-migration VERMELHO em 05/11.
-- Causa provada no dado (RD-38): a migration 20261105193145_rd100_blueprint_nomes_terceiros
-- criou o backup `public.blueprint_tela_requisito_bkp_rd100` com `CREATE TABLE (LIKE ...)`,
-- que NÃO copia RLS nem revoga os GRANTs herdados. Resultado: tabela SEM RLS e com SELECT para
-- `anon` (1723 linhas de metadado de produto expostas). O spec de segurança
-- `e2e/jornadas/aceitacao/seguranca-search-path-prb.spec.ts:36` reprovou porque
-- `fn_seguranca_rls_auditar()->>'ok'` = false (achado `tabela_sem_rls_com_anon`).
--
-- Correção: travar o backup (metadado de produto, NÃO é dado de cliente) — liga RLS e revoga
-- `anon`/`authenticated`. Sem policy, só o service_role/owner (BYPASSRLS) lê; nada que o usuário
-- vê depende dessa tabela. Prova em produção (BEGIN...ROLLBACK, só SELECT): depois da trava,
-- `fn_seguranca_rls_auditar()->>'ok'` = true e `total_achados` = 0.
--
-- Idempotente: ENABLE RLS já ligada = no-op; REVOKE de grant inexistente = no-op.
-- Code: gilberto-esteira

SET statement_timeout = '15s';
SET lock_timeout = '5s';

ALTER TABLE public.blueprint_tela_requisito_bkp_rd100 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blueprint_tela_requisito_bkp_rd100 FROM anon;
REVOKE ALL ON public.blueprint_tela_requisito_bkp_rd100 FROM authenticated;
