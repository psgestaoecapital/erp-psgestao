-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2ª ONDA RLS · 11 tabelas semi-sensíveis · multi-tenant hardening (mesmo padrão da 1ª onda)
-- ───────────────────────────────────────────────────────────────────────────────────────────
-- Aplicado via MCP (uma tabela por vez) e PROVADO em prod (usuário autenticado NÃO-admin, transação
-- abortada — zero efeito colateral): empresa A não lê linha da empresa B (zero); tela não quebra.
-- Backup pré-op das tabelas com dados no schema rls2_backup (descartável após validação do CEO).
--
-- Auditoria prévia: nenhuma policy dormente aberta nesta onda (só fichas_tecnicas tinha ft_all, tenant
-- legítima via user_company_ids() — subconjunto de get_user_company_ids(); trocada pela canônica, RD-52).
--
-- 3 tabelas do lote são CONFIG GLOBAL (100% das linhas com company_id NULL, zero linha por empresa) e ficaram
-- DE FORA aguardando decisão do CEO (policy company_id-only esconderia tudo e quebraria a tela):
--   bpo_sla_config (7 linhas NULL) · cost_type_rules (64 regras globais de classificação de custo) ·
--   projetos_insumo_categorias (11 categorias globais). Ver PR/RETORNO para a decisão pendente.
--
-- Provas (própria/outra empresa) — usuário Tryo Gesso socio não-admin (918c3ea4), outra = 1163bb56/KGF:
--   compliance_responsaveis .... 1 / 0 (total_visivel=1)
--   cost_center_map ............ 19 / 0 (total_visivel=19 — só Tryo tem dados)
--   erp_provider_config ........ 1 / 0 (config por empresa; token fica no Vault por referência)
--   projetos_mao_obra .......... 10 / 0
--   projetos_servicos .......... 10 / 0
--   psgc_omie_depto_ln_map ..... 4 / 0
--   rateio_config_empresa ...... 1 / 0
--   fichas_tecnicas ............ 1 / 0 (seed+abort; linha existente de outra empresa ficou invisível)
--   bpo_canais_cliente ......... 1 / 0 (seed+abort; vazia)
--   erp_dre_ordem_personalizada  1 / 0 (seed+abort; vazia)
--   psgc_contas_custom ......... 1 / 0 (seed+abort; vazia)
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- Política canônica reutilizada em todas: company_id IN (SELECT get_user_company_ids()) OR is_admin().

ALTER TABLE public.compliance_responsaveis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_responsaveis_rls ON public.compliance_responsaveis;
CREATE POLICY compliance_responsaveis_rls ON public.compliance_responsaveis FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.cost_center_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_center_map_rls ON public.cost_center_map;
CREATE POLICY cost_center_map_rls ON public.cost_center_map FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.erp_provider_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_provider_config_rls ON public.erp_provider_config;
CREATE POLICY erp_provider_config_rls ON public.erp_provider_config FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- fichas_tecnicas: troca ft_all (user_company_ids(), subconjunto) pela canônica (RD-52 fonte única).
ALTER TABLE public.fichas_tecnicas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ft_all ON public.fichas_tecnicas;
DROP POLICY IF EXISTS fichas_tecnicas_rls ON public.fichas_tecnicas;
CREATE POLICY fichas_tecnicas_rls ON public.fichas_tecnicas FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.projetos_mao_obra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_mao_obra_rls ON public.projetos_mao_obra;
CREATE POLICY projetos_mao_obra_rls ON public.projetos_mao_obra FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.projetos_servicos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_servicos_rls ON public.projetos_servicos;
CREATE POLICY projetos_servicos_rls ON public.projetos_servicos FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.psgc_omie_depto_ln_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psgc_omie_depto_ln_map_rls ON public.psgc_omie_depto_ln_map;
CREATE POLICY psgc_omie_depto_ln_map_rls ON public.psgc_omie_depto_ln_map FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.rateio_config_empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rateio_config_empresa_rls ON public.rateio_config_empresa;
CREATE POLICY rateio_config_empresa_rls ON public.rateio_config_empresa FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.bpo_canais_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpo_canais_cliente_rls ON public.bpo_canais_cliente;
CREATE POLICY bpo_canais_cliente_rls ON public.bpo_canais_cliente FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.erp_dre_ordem_personalizada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_dre_ordem_personalizada_rls ON public.erp_dre_ordem_personalizada;
CREATE POLICY erp_dre_ordem_personalizada_rls ON public.erp_dre_ordem_personalizada FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

ALTER TABLE public.psgc_contas_custom ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psgc_contas_custom_rls ON public.psgc_contas_custom;
CREATE POLICY psgc_contas_custom_rls ON public.psgc_contas_custom FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
