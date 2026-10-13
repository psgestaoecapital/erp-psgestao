-- 🚨 SEGURANÇA · PR B (CEO 28/09) — 137 funções SECURITY DEFINER sem SET search_path.
--
-- Função SECURITY DEFINER roda com os direitos do dono (postgres). Sem search_path fixo, ela resolve nomes não
-- qualificados pelo search_path de QUEM CHAMA — quem conseguir criar objeto num schema que venha antes no caminho
-- (ou manipular o search_path da sessão) faz a função do dono executar código dele. Correção padrão: fixar o caminho.
--
-- Valor escolhido: public, extensions, pg_temp — o MESMO que essas funções já resolvem hoje pelo PostgREST
-- (db-schemas public + extra-search-path extensions), então nada muda de comportamento:
--   · 2 usam função de extensão sem schema (fn_bpo_fechamento_executar_lote, fn_compliance_epi_gerar_link_whatsapp);
--   · 34 chamam auth./net./vault./cron./storage. já qualificados (não dependem do caminho);
--   · pg_temp por último: tabela temporária nunca "sombreia" tabela real.
-- Idempotente: só toca SECURITY DEFINER do schema public sem search_path; ao final exige zero.
-- E fn_seguranca_rls_auditar passa a acusar 'funcao_definer_sem_search_path' (conta no ok/total_achados do briefing):
-- função nova sem caminho fixo vira alerta no dia seguinte, não auditoria manual.

DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prokind IN ('f','p')
      AND NOT coalesce(array_to_string(p.proconfig, ','), '') ~ 'search_path'
  LOOP
    EXECUTE format('ALTER ROUTINE %s SET search_path = public, extensions, pg_temp', f.assinatura);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'PR B: search_path fixado em % funções', n;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
             AND NOT coalesce(array_to_string(p.proconfig, ','), '') ~ 'search_path') THEN
    RAISE EXCEPTION 'PR B: ainda há SECURITY DEFINER sem search_path';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_seguranca_rls_auditar() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (
    SELECT c.oid, c.relname, c.relrowsecurity rls,
      EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema='public' AND ic.table_name=c.relname AND ic.column_name='company_id') tem_company,
      (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'TRUNCATE')) anon_alcanca
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ),
  v AS (
    SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') anon_le,
      c.relkind = 'v' AND NOT coalesce(EXISTS (SELECT 1 FROM unnest(c.reloptions) o WHERE o IN ('security_invoker=on','security_invoker=true','security_invoker=1')), false) dono
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')
  ),
  f AS (
    SELECT p.oid::regprocedure::text AS assinatura FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prokind IN ('f','p')
      AND NOT coalesce(array_to_string(p.proconfig, ','), '') ~ 'search_path'
  ),
  r AS (
    SELECT
      (SELECT coalesce(jsonb_agg(assinatura ORDER BY assinatura), '[]') FROM f) definer_sem_path,
      (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM t WHERE tem_company AND NOT rls) sem_rls_company,
      (SELECT coalesce(jsonb_agg(tablename||'.'||policyname ORDER BY tablename, policyname), '[]') FROM pg_policies p
          WHERE p.schemaname='public' AND ('anon'=ANY(p.roles) OR 'public'=ANY(p.roles))
            AND (coalesce(p.qual,'') IN ('true','(true)') OR coalesce(p.with_check,'') IN ('true','(true)'))
            AND p.tablename IN (SELECT relname FROM t WHERE tem_company)) policy_company,
      (SELECT coalesce(jsonb_agg(DISTINCT g.table_name), '[]') FROM information_schema.role_table_grants g
          JOIN t ON t.relname=g.table_name WHERE g.table_schema='public' AND g.grantee='anon'
            AND g.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE') AND t.tem_company AND NOT t.rls) anon_escrita_company,
      (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM t WHERE NOT rls AND anon_alcanca) sem_rls_anon,
      (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM v WHERE anon_le) view_anon,
      (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM v WHERE dono) view_dono,
      (SELECT coalesce(jsonb_agg(p.tablename||'.'||p.policyname ORDER BY p.tablename, p.policyname), '[]') FROM pg_policies p
          JOIN t ON t.relname = p.tablename
          WHERE p.schemaname='public' AND ('anon'=ANY(p.roles) OR 'public'=ANY(p.roles)) AND t.anon_alcanca
            AND (coalesce(p.qual,'') IN ('true','(true)') OR coalesce(p.with_check,'') IN ('true','(true)'))) policy_anon
  )
  SELECT jsonb_build_object(
    'ok', (jsonb_array_length(sem_rls_anon) + jsonb_array_length(view_anon) + jsonb_array_length(view_dono)
           + jsonb_array_length(policy_anon) + jsonb_array_length(sem_rls_company) + jsonb_array_length(anon_escrita_company)
           + jsonb_array_length(definer_sem_path)) = 0,
    'total_achados', jsonb_array_length(sem_rls_anon) + jsonb_array_length(view_anon) + jsonb_array_length(view_dono)
           + jsonb_array_length(policy_anon) + jsonb_array_length(sem_rls_company) + jsonb_array_length(anon_escrita_company)
           + jsonb_array_length(definer_sem_path),
    'tabela_sem_rls_com_anon', sem_rls_anon,
    'view_legivel_por_anon', view_anon,
    'view_com_direitos_do_dono', view_dono,
    'policy_aberta_para_anon', policy_anon,
    'sem_rls_com_company_id', sem_rls_company,
    'policy_aberta_public', policy_company,
    'anon_com_escrita_em_tabela_de_empresa', anon_escrita_company,
    'funcao_definer_sem_search_path', definer_sem_path,
    'regra', 'Tabela nova nasce com RLS e sem GRANT ao anon; view nova nasce com security_invoker=on; função SECURITY DEFINER nova nasce com SET search_path; anon nunca lê view. Achado aqui = trabalho AGORA, antes de chamado.'
  ) FROM r
$$;
REVOKE ALL ON FUNCTION public.fn_seguranca_rls_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seguranca_rls_auditar() TO service_role;
