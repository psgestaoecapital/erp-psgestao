-- PR-FIX · isolamento multi-tenant em financiamentos + escrita controlada em parcelas
-- Furo descoberto: financiamentos tinha rls_enabled=false e a policy permissiva
-- allow_all_fin aberta a todos. Exposicao cruzada entre BPO companies
-- (Grupo Tryo veria contratos de outras empresas).

DROP POLICY IF EXISTS allow_all_fin ON public.financiamentos;
ALTER TABLE public.financiamentos ENABLE ROW LEVEL SECURITY;
-- fin_all ja cobre ALL (is_admin() OR company_id IN user_company_ids).

DROP POLICY IF EXISTS p_fin_parcelas_ins ON public.financiamento_parcelas;
CREATE POLICY p_fin_parcelas_ins ON public.financiamento_parcelas
  FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS p_fin_parcelas_upd ON public.financiamento_parcelas;
CREATE POLICY p_fin_parcelas_upd ON public.financiamento_parcelas
  FOR UPDATE
  USING      (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
