-- P1.b-2 SEGURANÇA — escopa por tenant as LEITURAS always-true (advisor rls_policy_always_true, leitura).
-- Padrão: company_id IN (SELECT get_user_company_ids()) OR public.is_admin()
--   cliente vê só as próprias empresas; staff PS (is_admin) vê tudo; service_role bypassa (edges/cron/RPCs);
--   anon sem política → bloqueado. NÃO inclui operator_clients/category_mapping/lgpd_consentimentos (excluídas).
--
-- Auditoria (RD-38): as 7 tabelas têm company_id; os nomes dos DROP batem 1:1; as políticas dropadas são
--   always-true (USING=true). erp_nfe_eventos já tinha nfe_eventos_tenant_isolation (escopada) — mantida.
--
-- DESVIO CONSCIENTE vs SPEC (RD-51): bpo_rotinas tinha DUAS políticas always-true — além de allow_all_bpo_rot,
--   existia "Auth users manage rotinas" (USING auth.uid() IS NOT NULL = qualquer logado vê tudo). O advisor
--   não a lista (não é literalmente `true`), mas funcionalmente é o mesmo vazamento cross-tenant; sem removê-la
--   o fix de bpo_rotinas seria inócuo (RLS é OR). Por isso ela também é dropada aqui.
--
-- Prova (tx abortada, authenticated não-admin simulado): READ própria empresa=TRUE, READ alheia=FALSE.

DROP POLICY IF EXISTS "allow_all_bpo_execucoes" ON public.bpo_execucoes;
CREATE POLICY "bpo_execucoes_tenant" ON public.bpo_execucoes FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "allow_all_bpo_rot" ON public.bpo_rotinas;
DROP POLICY IF EXISTS "Auth users manage rotinas" ON public.bpo_rotinas;  -- desvio: 2ª always-true (auth.uid() IS NOT NULL)
CREATE POLICY "bpo_rotinas_tenant" ON public.bpo_rotinas FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "allow_all_bpo_sync" ON public.bpo_sync_log;
CREATE POLICY "bpo_sync_log_tenant" ON public.bpo_sync_log FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "ch_all" ON public.company_hierarchy;
CREATE POLICY "company_hierarchy_tenant" ON public.company_hierarchy FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "rr_all" ON public.rateio_regras;
CREATE POLICY "rateio_regras_tenant" ON public.rateio_regras FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "nfe_eventos_service_role" ON public.erp_nfe_eventos;
CREATE POLICY "erp_nfe_eventos_tenant" ON public.erp_nfe_eventos FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS "allow_all_viab" ON public.viability_analyses;
CREATE POLICY "viability_analyses_tenant" ON public.viability_analyses FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

-- ROLLBACK: recriar as políticas ALL originais (nomes nos DROP) com USING/CHECK true (e a "Auth users manage
--   rotinas" com USING auth.uid() IS NOT NULL, se realmente quiser reabrir).
