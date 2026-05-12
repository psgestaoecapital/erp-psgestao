-- migrations/20260512092108_rls_multi_tenancy_bpo.sql
-- Aplica RLS multi-tenant estrito em 6 tabelas BPO antes vulneraveis.
-- Padrao: company_id IN get_user_company_ids() OR is_admin()
-- Idempotente: pode rodar varias vezes sem efeito colateral.

BEGIN;

-- 1) bpo_fechamento_mensal (RLS estava desabilitado)
ALTER TABLE public.bpo_fechamento_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpo_fechamento_mensal_select_strict ON public.bpo_fechamento_mensal;
DROP POLICY IF EXISTS bpo_fechamento_mensal_modify_strict ON public.bpo_fechamento_mensal;
DROP POLICY IF EXISTS allow_all_bpo_fechamento_mensal ON public.bpo_fechamento_mensal;

CREATE POLICY bpo_fechamento_mensal_select_strict
  ON public.bpo_fechamento_mensal
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_fechamento_mensal_modify_strict
  ON public.bpo_fechamento_mensal
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- 2) bpo_inbox_items (RLS estava desabilitado)
ALTER TABLE public.bpo_inbox_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpo_inbox_items_select_strict ON public.bpo_inbox_items;
DROP POLICY IF EXISTS bpo_inbox_items_modify_strict ON public.bpo_inbox_items;

CREATE POLICY bpo_inbox_items_select_strict
  ON public.bpo_inbox_items
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_inbox_items_modify_strict
  ON public.bpo_inbox_items
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- 3) bpo_alertas (policy allow_all frouxa)
DROP POLICY IF EXISTS allow_all_bpo_alertas ON public.bpo_alertas;
DROP POLICY IF EXISTS bpo_alertas_select_strict ON public.bpo_alertas;
DROP POLICY IF EXISTS bpo_alertas_modify_strict ON public.bpo_alertas;

CREATE POLICY bpo_alertas_select_strict
  ON public.bpo_alertas
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_alertas_modify_strict
  ON public.bpo_alertas
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- 4) bpo_classificacoes (policy allow_all frouxa)
DROP POLICY IF EXISTS allow_all_bpo_class ON public.bpo_classificacoes;
DROP POLICY IF EXISTS allow_all_bpo_classificacoes ON public.bpo_classificacoes;
DROP POLICY IF EXISTS bpo_classificacoes_select_strict ON public.bpo_classificacoes;
DROP POLICY IF EXISTS bpo_classificacoes_modify_strict ON public.bpo_classificacoes;

CREATE POLICY bpo_classificacoes_select_strict
  ON public.bpo_classificacoes
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_classificacoes_modify_strict
  ON public.bpo_classificacoes
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- 5) bpo_contratos (policy allow_all frouxa)
DROP POLICY IF EXISTS allow_all_bpo_contratos ON public.bpo_contratos;
DROP POLICY IF EXISTS bpo_contratos_select_strict ON public.bpo_contratos;
DROP POLICY IF EXISTS bpo_contratos_modify_strict ON public.bpo_contratos;

CREATE POLICY bpo_contratos_select_strict
  ON public.bpo_contratos
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_contratos_modify_strict
  ON public.bpo_contratos
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- 6) bpo_tarefas (policy so checava auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS "Auth users manage tarefas" ON public.bpo_tarefas;
DROP POLICY IF EXISTS bpo_tarefas_select_strict ON public.bpo_tarefas;
DROP POLICY IF EXISTS bpo_tarefas_modify_strict ON public.bpo_tarefas;

CREATE POLICY bpo_tarefas_select_strict
  ON public.bpo_tarefas
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

CREATE POLICY bpo_tarefas_modify_strict
  ON public.bpo_tarefas
  FOR ALL
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin())
  WITH CHECK ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

COMMENT ON POLICY bpo_fechamento_mensal_select_strict ON public.bpo_fechamento_mensal IS
  'RLS multi-tenant aplicado em 2026-05-12 para fechar vulnerabilidade Pilar 2 Estrela Polar';
COMMENT ON POLICY bpo_inbox_items_select_strict ON public.bpo_inbox_items IS
  'RLS multi-tenant aplicado em 2026-05-12 para fechar vulnerabilidade Pilar 2 Estrela Polar';

COMMIT;
