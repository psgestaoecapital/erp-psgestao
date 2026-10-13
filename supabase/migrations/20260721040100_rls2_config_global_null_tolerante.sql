-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2ª ONDA RLS · 3 tabelas de CONFIG GLOBAL · policy tolerante a NULL (GO CEO opção B)
-- ───────────────────────────────────────────────────────────────────────────────────────────
-- Estas 3 tabelas têm 100% das linhas com company_id NULL (config global). Uma policy company_id-only
-- esconderia tudo e quebraria a tela. Por isso:
--   USING      = company_id IS NULL OR company_id IN get_user_company_ids() OR is_admin()
--                → linha GLOBAL (NULL) = todos autenticados leem; linha por-empresa = só a dona; admin = tudo.
--   WITH CHECK = company_id IN get_user_company_ids() OR is_admin()  (SEM NULL)
--                → não-admin NÃO cria/altera config global; só override da própria empresa. Admin/SERVICE_ROLE = tudo.
--
-- Escrita real é server/admin: custos/processar (cost_type_rules) usa SERVICE_ROLE; projetos/insumos/page só LÊ
-- com .or(company_id.is.null, company_id.eq.<empresa>) — confirmado no código (RD-38).
--
-- PROVADO em prod (usuário Tryo Gesso socio não-admin, transação abortada):
--   globais ainda carregam: bpo_sla_config=7 · cost_type_rules=64 · projetos_insumo_categorias=11
--   override de outra empresa (KGF) invisível: 0/0/0
--   criar linha global (NULL) por não-admin: BARRADO
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bpo_sla_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpo_sla_config_rls ON public.bpo_sla_config;
CREATE POLICY bpo_sla_config_rls ON public.bpo_sla_config FOR ALL TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.cost_type_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_type_rules_rls ON public.cost_type_rules;
CREATE POLICY cost_type_rules_rls ON public.cost_type_rules FOR ALL TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.projetos_insumo_categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_insumo_categorias_rls ON public.projetos_insumo_categorias;
CREATE POLICY projetos_insumo_categorias_rls ON public.projetos_insumo_categorias FOR ALL TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
