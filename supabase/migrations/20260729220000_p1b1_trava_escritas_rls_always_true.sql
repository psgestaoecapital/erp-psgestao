-- P1.b-1 SEGURANÇA — trava ESCRITAS expostas (advisor rls_policy_always_true, subconjunto de escrita).
-- Só políticas de ESCRITA always-true; nenhuma leitura alterada → nenhuma tela de listagem muda.
-- Auditado (RD-38): service_role BYPASSA RLS (rolbypassrls=true) → edges/cron/RPCs SECURITY DEFINER
--   intactos; as 12 políticas dropadas são comprovadamente always-true (check=true / using=true);
--   as ALL|public das DRE ("Users see own org…") são ESCOPADAS por org_id (mantidas, não são buraco);
--   get_user_company_ids() existe; company_id existe onde escopado.
-- Prova (tx abortada, papel authenticated simulado): usuário de 1 empresa → WRITE própria=TRUE,
--   WRITE empresa alheia=FALSE.

-- 1) WEALTH PLUGGY — ingestão é service_role (bypass). Remove INSERT público.
DROP POLICY IF EXISTS "pluggy_raw_service_insert"      ON public.wealth_pluggy_raw;
DROP POLICY IF EXISTS "pluggy_sync_log_service_insert" ON public.wealth_pluggy_sync_log;
DROP POLICY IF EXISTS "pluggy_sync_req_service"        ON public.wealth_pluggy_sync_requests;
CREATE POLICY "pluggy_raw_insert_service" ON public.wealth_pluggy_raw      FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "pluggy_log_insert_service" ON public.wealth_pluggy_sync_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "pluggy_req_insert_service" ON public.wealth_pluggy_sync_requests FOR INSERT TO service_role WITH CHECK (true);

-- 2) CONCILIAÇÃO — escritas escopadas por company_id (service_role full já existe).
DROP POLICY IF EXISTS "auth insert" ON public.conciliacao_lote;
DROP POLICY IF EXISTS "auth update" ON public.conciliacao_lote;
CREATE POLICY "conc_lote_ins_tenant" ON public.conciliacao_lote FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "conc_lote_upd_tenant" ON public.conciliacao_lote FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS "auth insert" ON public.conciliacao_movimento;
DROP POLICY IF EXISTS "auth update" ON public.conciliacao_movimento;
CREATE POLICY "conc_mov_ins_tenant" ON public.conciliacao_movimento FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "conc_mov_upd_tenant" ON public.conciliacao_movimento FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS "auth insert" ON public.conciliacao_regra;
DROP POLICY IF EXISTS "auth update" ON public.conciliacao_regra;
CREATE POLICY "conc_regra_ins_tenant" ON public.conciliacao_regra FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "conc_regra_upd_tenant" ON public.conciliacao_regra FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS "conc_vinculo_insert" ON public.conciliacao_vinculo;
DROP POLICY IF EXISTS "conc_vinculo_update" ON public.conciliacao_vinculo;
DROP POLICY IF EXISTS "conc_vinculo_delete" ON public.conciliacao_vinculo;
CREATE POLICY "conc_vinc_ins_tenant" ON public.conciliacao_vinculo FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "conc_vinc_upd_tenant" ON public.conciliacao_vinculo FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "conc_vinc_del_tenant" ON public.conciliacao_vinculo FOR DELETE TO authenticated USING (company_id IN (SELECT get_user_company_ids()));

-- 3) DRE — escritas escopadas por company_id (mantém a ALL org-escopada existente).
DROP POLICY IF EXISTS "Anyone can insert m2" ON public.m2_dre_divisional;
DROP POLICY IF EXISTS "Anyone can update m2" ON public.m2_dre_divisional;
CREATE POLICY "m2_ins_tenant" ON public.m2_dre_divisional FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "m2_upd_tenant" ON public.m2_dre_divisional FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS "Anyone can insert m3" ON public.m3_dre_sede;
DROP POLICY IF EXISTS "Anyone can update m3" ON public.m3_dre_sede;
CREATE POLICY "m3_ins_tenant" ON public.m3_dre_sede FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY "m3_upd_tenant" ON public.m3_dre_sede FOR UPDATE TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- 4) ai_reports — INSERT escopado.
DROP POLICY IF EXISTS "Anyone can insert ai_reports" ON public.ai_reports;
CREATE POLICY "ai_reports_ins_tenant" ON public.ai_reports FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ROLLBACK: recriar as políticas originais (nomes nos DROP acima) com USING/CHECK true.
