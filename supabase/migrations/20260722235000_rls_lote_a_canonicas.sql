-- LOTE A — policy canônica (company_id/empresa_id) em 7 tabelas client-direct que estavam
-- travadas (RLS on + 0 policies = deny all). Padrão: tenant IN get_user_company_ids() OR is_admin().
CREATE POLICY p_ln_budget ON public.linhas_negocio_budget
  FOR ALL USING (empresa_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (empresa_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_fiscal_apuracoes ON public.fiscal_apuracoes
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_fiscal_calendario ON public.fiscal_calendario
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_fiscal_configuracao ON public.fiscal_configuracao
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_fiscal_split_payment ON public.fiscal_split_payment
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_ind_unidades ON public.ind_unidades
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY p_m16_insumos ON public.m16_insumos
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
