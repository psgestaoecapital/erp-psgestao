-- LOTE B — tabelas ind_* sem coluna tenant própria: escopo por JOIN em ind_unidades.company_id.
-- Isolamento provado (tx abortada): usuário da empresa A não lê KPIs da empresa B.
CREATE POLICY p_ind_alertas_ceo ON public.ind_alertas_ceo
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_apontamentos_bovinos ON public.ind_apontamentos_bovinos
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_custos_turno ON public.ind_custos_turno
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_kpis_diarios ON public.ind_kpis_diarios
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_lotes_animais ON public.ind_lotes_animais
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_qualidade_sif ON public.ind_qualidade_sif
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());

CREATE POLICY p_ind_turnos ON public.ind_turnos
  FOR ALL USING (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK (unidade_id IN (SELECT id FROM public.ind_unidades WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());
