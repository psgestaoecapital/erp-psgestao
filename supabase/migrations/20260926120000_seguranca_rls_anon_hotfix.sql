-- 🚨 SEGURANCA — achado da auditoria RLS de 26/09 (contexto a cristalizar) · Pilar 2 (RLS multi-tenant / LGPD)
-- (A) 24 tabelas com company_id SEM RLS e com GRANT total para anon (chave publica do frontend):
--     backups de erp_pagar/erp_receber da KGF (1.050 + 848 linhas), clientes PS Capital (74), outbox (9.983), etc.
-- (B) 8 tabelas com RLS mas policy "USING (true)" para public/anon: m2_dre_divisional, m3_dre_sede, invites (ALL),
--     custos_sede (ALL), category_mapping (ALL), operator_clients (ALL), erp_fiscal_remessa_tipos (ALL), ai_reports.
-- Correcao: RLS ligada + REVOKE anon + policy por empresa onde o app le com o JWT do usuario. Sem DELETE, sem DROP (RD-30/55).

-- ---------- (A) ligar RLS e tirar anon ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erp_outbox_sync','_backup_kgf_pagar_20260803','_backup_kgf_receber_20260803','erp_carregamento_travamento',
    '_backup_psgc_depara_tryo_20260803','_backup_limpeza_20260801_pagar','_backup_ajuda_artigo_20260805',
    '_backup_limpeza_20260801_receber','bkp_os_totais_20260824','bkp_conc_vinculo_orfaos_20260824',
    'bkp_clientes_pscapital_20260828','_bkp_pesagem_virgula_umuarama_20260826','_backup_atak_fonte_mapa_20260804',
    '_backup_obras_fantasma_20260807','_backup_pagar_codbarras_20260804','data_source_call_logs','data_source_runs',
    'erp_auditor_matriz_runs','erp_banco_teste_resultado','erp_cfop_categoria','erp_cfop_conversao','erp_fidelidade_log',
    'erp_sync_agenda','projetos_modulo_config'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;

-- tabelas operacionais que o app le com o JWT do usuario: policy por empresa (leitura; escrita segue pelo service role)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_banco_teste_resultado','data_source_runs','data_source_call_logs','erp_cfop_categoria','erp_cfop_conversao',
                           'erp_fidelidade_log','erp_sync_agenda','projetos_modulo_config','erp_carregamento_travamento','erp_outbox_sync','erp_auditor_matriz_runs'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON public.%I', t);
      EXECUTE format('CREATE POLICY "tenant_select" ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())', t);
    END IF;
  END LOOP;
END $$;
-- backups: RLS ligada e NENHUMA policy = invisiveis pelo app (service role/MCP continuam lendo). Nao apagar (RD-30).

-- ---------- (B) policies "true" abertas ao publico ----------
-- m2/m3 (DRE): leitura so por empresa
DROP POLICY IF EXISTS "Anyone can read m2" ON public.m2_dre_divisional;
CREATE POLICY "tenant_select" ON public.m2_dre_divisional FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS "Anyone can read m3" ON public.m3_dre_sede;
CREATE POLICY "tenant_select" ON public.m3_dre_sede FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
-- ai_reports: leitura por empresa
DROP POLICY IF EXISTS "Anyone can read ai_reports" ON public.ai_reports;
CREATE POLICY "tenant_select" ON public.ai_reports FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
-- custos_sede / category_mapping / operator_clients / remessa_tipos: ALL aberto -> por empresa, so autenticado
DROP POLICY IF EXISTS "allow_all_csede" ON public.custos_sede;
CREATE POLICY "tenant_all" ON public.custos_sede FOR ALL TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin()) WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS "cm_all" ON public.category_mapping;
CREATE POLICY "tenant_all" ON public.category_mapping FOR ALL TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin()) WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS "allow_all_opcli" ON public.operator_clients;
DROP POLICY IF EXISTS "allow_all_op_clients" ON public.operator_clients;
CREATE POLICY "tenant_all" ON public.operator_clients FOR ALL TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin()) WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS "remessa_tipos_service_role" ON public.erp_fiscal_remessa_tipos;
CREATE POLICY "tenant_all" ON public.erp_fiscal_remessa_tipos FOR ALL TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin()) WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
-- invites: convite e lido por TOKEN na rota publica (anon precisa SELECT por token); nunca listar tudo, nunca INSERT/UPDATE anonimo
DROP POLICY IF EXISTS "Anyone can insert invite" ON public.invites;
DROP POLICY IF EXISTS "Anyone can update invite" ON public.invites;
DROP POLICY IF EXISTS "allow_all_inv" ON public.invites;
-- "Anyone can read invite" fica ATE o Code Web confirmar que a rota publica filtra por token; entao vira RPC SECURITY DEFINER e a policy sai.

-- REGISTRO da regra que impede recorrencia (RD nova via catalogo)
SELECT fn_rd_registrar(
  'Toda tabela com company_id nasce com RLS ligada e policy por empresa; anon nunca recebe GRANT em tabela de dominio; backup e copia tem o mesmo RLS da origem',
  'Achado 26/09: 24 tabelas (backups de pagar/receber, clientes PS Capital, outbox) sem RLS e com GRANT total para anon; 8 policies USING(true) para public (DRE m2/m3, invites, custos_sede...). Gate: fn_seguranca_rls_auditar() no briefing (tabelas com company_id sem RLS ou com policy aberta = alerta critico).',
  'lei', 'banco', 'fn_seguranca_rls_auditar() no fn_briefing_sessao', '26/09 auditoria RLS');

-- ---------- gate: auditoria continua no briefing ----------
CREATE OR REPLACE FUNCTION public.fn_seguranca_rls_auditar() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (
    SELECT c.relname, c.relrowsecurity rls,
      EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema='public' AND ic.table_name=c.relname AND ic.column_name='company_id') tem_company
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
  )
  SELECT jsonb_build_object(
    'sem_rls_com_company_id', (SELECT coalesce(jsonb_agg(relname), '[]') FROM t WHERE tem_company AND NOT rls),
    'policy_aberta_public', (SELECT coalesce(jsonb_agg(tablename||'.'||policyname), '[]') FROM pg_policies p
        WHERE p.schemaname='public' AND ('anon'=ANY(p.roles) OR 'public'=ANY(p.roles))
          AND (coalesce(p.qual,'') IN ('true','(true)') OR coalesce(p.with_check,'') IN ('true','(true)'))
          AND p.tablename IN (SELECT relname FROM t WHERE tem_company)),
    'anon_com_escrita_em_tabela_de_empresa', (SELECT coalesce(jsonb_agg(DISTINCT g.table_name), '[]') FROM information_schema.role_table_grants g
        JOIN t ON t.relname=g.table_name WHERE g.table_schema='public' AND g.grantee='anon' AND g.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE') AND t.tem_company AND NOT t.rls)
  )
$$;
