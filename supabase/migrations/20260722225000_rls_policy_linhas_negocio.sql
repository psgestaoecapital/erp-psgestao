-- BUG BLOQUEANTE: linhas_negocio tinha RLS ON e ZERO policies -> ninguém criava LDN
-- ("new row violates row-level security policy"). Coluna tenant = empresa_id (= companies.id).
CREATE POLICY p_linhas_negocio ON public.linhas_negocio
  FOR ALL USING (empresa_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (empresa_id IN (SELECT get_user_company_ids()) OR is_admin());
