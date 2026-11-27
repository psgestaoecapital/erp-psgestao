-- conserto-main (gilberto-esteira, CEO 27/11) — @pos-migration da main VERMELHO (run 46072774507):
-- fn_seguranca_rls_auditar acusou tabela_sem_rls_com_anon = [erp_ajuda_campo_bkp_permutas_move,
-- module_catalog_bkp_permutas_move] (spec de SEGURANÇA e2e/jornadas/aceitacao/seguranca-search-path-prb.spec.ts:36).
--
-- Causa (provada no dado, RD-38): a migration 20261129200010_permutas_hub_para_ge_financeiro criou os 2 backups
-- (RD-52, cópia ANTES do UPDATE) com `create table`, mas sem ligar RLS nem revogar anon — então nasceram legíveis
-- por anon, ao contrário de TODO outro _bkp do schema (27 tabelas: relrowsecurity=true, sem grant a anon). São
-- backups de CATÁLOGO GLOBAL (module_catalog = menu; erp_ajuda_campo = textos de ajuda RD-95); NÃO há dado de
-- cliente, fiscal, financeiro, LGPD nem NR-36.
--
-- Fix (mesmo baseline de todo backup): liga RLS (sem policy = só service_role/owner lê, igual aos outros _bkp) e
-- revoga anon/authenticated. Idempotente: ENABLE RLS e REVOKE são no-op se já aplicado — já aplicado à mão no
-- hotfix que destravou a esteira em 27/11; o deploy-migrations reaplica como no-op e carimba a versão-de-arquivo.
-- NÃO altera o spec de segurança (proibido): fecha o buraco real que ele acusou.

alter table if exists public.module_catalog_bkp_permutas_move enable row level security;
revoke all on public.module_catalog_bkp_permutas_move from anon, authenticated;

alter table if exists public.erp_ajuda_campo_bkp_permutas_move enable row level security;
revoke all on public.erp_ajuda_campo_bkp_permutas_move from anon, authenticated;

-- PROVA RD-38 — estado final das 2 tabelas: RLS ligada e sem grant a anon (específico, não depende de outros achados)
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relname in ('module_catalog_bkp_permutas_move', 'erp_ajuda_campo_bkp_permutas_move')
    and (
      c.relrowsecurity = false
      or exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon'
      )
    );
  if v_bad > 0 then
    raise exception 'conserto-main: backups permutas ainda sem RLS ou com grant a anon (% pendente[s])', v_bad;
  end if;
  raise notice 'conserto-main OK: backups permutas com RLS e sem anon';
end $$;
