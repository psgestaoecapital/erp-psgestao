-- 🚨 SEGURANÇA · auditoria ampliada no briefing (CEO 28/09).
--
-- A lacuna: fn_seguranca_rls_auditar (26/09) só olhava tabela COM company_id. As 92 tabelas sem RLS e com GRANT
-- total ao anon (permissões, catálogos, backups, debug, handoff...) não têm company_id — passaram caladas. E a
-- auditoria nem chegava ao briefing: a RD de 26/09 dizia "no fn_briefing_sessao", mas a chave nunca foi ligada.
--
-- (1) fn_seguranca_rls_auditar passa a acusar, em TODO o schema public (não só company_id):
--     - tabela_sem_rls_com_anon: tabela sem RLS em que o anon tem QUALQUER privilégio;
--     - view_legivel_por_anon: view/materialized view com SELECT para anon;
--     - view_com_direitos_do_dono: view sem security_invoker (roda como o dono e PULA a RLS das tabelas —
--       vazamento entre empresas para qualquer logado);
--     - policy_aberta_para_anon: policy USING/WITH CHECK (true) para anon/public em tabela que o anon alcança;
--     - total_achados e ok (true = nada a acusar).
--     As 3 chaves antigas continuam (mesmo nome e significado) para quem já as lê.
--     Deixa de ser executável pelo logado comum (lista de brechas não é para cliente): só service_role e o
--     briefing (SECURITY DEFINER do dono).
-- (2) fn_briefing_sessao ganha a chave 'seguranca_rls' e, havendo achado, alertas_pendentes_para_ceo.seguranca_rls
--     (patch idempotente por âncora, como em 20260926210000 — o corpo vigente é preservado).

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
  r AS (
    SELECT
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
           + jsonb_array_length(policy_anon) + jsonb_array_length(sem_rls_company) + jsonb_array_length(anon_escrita_company)) = 0,
    'total_achados', jsonb_array_length(sem_rls_anon) + jsonb_array_length(view_anon) + jsonb_array_length(view_dono)
           + jsonb_array_length(policy_anon) + jsonb_array_length(sem_rls_company) + jsonb_array_length(anon_escrita_company),
    'tabela_sem_rls_com_anon', sem_rls_anon,
    'view_legivel_por_anon', view_anon,
    'view_com_direitos_do_dono', view_dono,
    'policy_aberta_para_anon', policy_anon,
    'sem_rls_com_company_id', sem_rls_company,
    'policy_aberta_public', policy_company,
    'anon_com_escrita_em_tabela_de_empresa', anon_escrita_company,
    'regra', 'Tabela nova nasce com RLS e sem GRANT ao anon; view nova nasce com security_invoker=on; anon nunca lê view. Achado aqui = trabalho AGORA, antes de chamado.'
  ) FROM r
$$;
REVOKE ALL ON FUNCTION public.fn_seguranca_rls_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seguranca_rls_auditar() TO service_role;

-- (2) briefing
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'fn_briefing_sessao';
  IF v_def !~ 'fn_seguranca_rls_auditar' THEN
    v_new := replace(v_def, E'  RETURN v_result;\nEND;',
      E'  -- 28/09: segurança no briefing — toda tabela sem RLS com anon, view legível por anon ou com direitos do dono\n'
      || E'  v_result := v_result || jsonb_build_object(''seguranca_rls'', public.fn_seguranca_rls_auditar());\n'
      || E'  IF NOT coalesce((v_result->''seguranca_rls''->>''ok'')::boolean, true) THEN\n'
      || E'    v_result := jsonb_set(v_result, ''{alertas_pendentes_para_ceo,seguranca_rls}'', jsonb_build_object(\n'
      || E'      ''total_achados'', v_result->''seguranca_rls''->''total_achados'',\n'
      || E'      ''acao'', ''SEGURANÇA à frente de qualquer chamado: fechar as tabelas/views listadas em seguranca_rls''), true);\n'
      || E'  END IF;\n'
      || E'  RETURN v_result;\nEND;');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora RETURN v_result nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO service_role;
