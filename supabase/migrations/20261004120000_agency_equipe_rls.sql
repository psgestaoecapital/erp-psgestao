-- ============================================================
-- P&M · agency_equipe: RLS ligada mas SEM policy (deny-all) → a tela /dashboard/pm/equipe,
-- que lê e grava direto pelo cliente, não enxerga nem salva nada.
-- Provado no banco em 04/10: relrowsecurity=true, pg_policies=0 linhas, 7 linhas na tabela.
-- A PR #306 prometia "próxima PR adiciona policy agency_equipe_all pattern company_id": é esta.
-- Mesmo padrão das demais agency_* (agency_clientes_access, agency_jobs_access): empresa do usuário OU admin.
-- Aditivo e idempotente; nenhum dado é tocado.
-- ============================================================
ALTER TABLE public.agency_equipe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_equipe_access ON public.agency_equipe;
CREATE POLICY agency_equipe_access ON public.agency_equipe FOR ALL
  USING      ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
