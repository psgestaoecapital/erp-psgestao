-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- RLS nas 8 tabelas de risco ALTO · multi-tenant hardening (RD-54/RD-55: prova pré/pós antes de asserir)
-- ───────────────────────────────────────────────────────────────────────────────────────────
-- Aplicado via MCP (uma tabela por vez) e PROVADO em prod (usuário autenticado NÃO-admin, transação
-- abortada — zero efeito colateral): como usuário da empresa A, leitura de linha da empresa B = 0.
--
-- ACHADO SISTÊMICO (RD-35): várias tabelas tinham POLICIES DORMENTES criadas com RLS DESLIGADO.
--   balanco_patrimonial tinha 'allow_all_bp' (qual=true, role public) — ao LIGAR o RLS ela abriria a
--   porta pra todas as empresas. Por isso: auditar policies existentes ANTES de ligar, e derrubar as
--   abertas. erp_produtos estava limpa (prova passou: própria=1725, outra=0).
--
-- Política canônica (padrão erp_pagar): company_id IN (SELECT get_user_company_ids()) OR is_admin().
-- Rotas server que escrevem (custos/processar, omie sync) usam SERVICE_ROLE → bypassam RLS (seguem OK).
--
-- Provas (própria/outra empresa) por tabela:
--   erp_produtos ............... 1725 / 0        (usuário KGF socio não-admin)
--   balanco_patrimonial ........ 1 / 0 + insert alheio barrado  (vazia; policies abertas removidas)
--   cost_allocations ........... 718 / 0         (usuário Tryo Gesso socio não-admin)
--   bpo_conversas .............. 1 / 0 + insert alheio barrado  (fecha buraco: fetch por id sem company)
--   erp_fechamento_periodo ..... 1 / 0 + insert alheio barrado  (vazia; defense-in-depth)
--   api_integrations ........... própria não-admin = 0  (SEGREDOS → só is_admin(); NÃO company_id)
--   rateio_distribuicao_calc ... 328 / 0         (defense-in-depth)
--   erp_entity_mapping ......... 5225 / 0        (defense-in-depth)
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- 1 · erp_produtos (client-direct: ProdutoAutocomplete, produtos/page, commerce/estoque, cotacoes)
ALTER TABLE public.erp_produtos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_produtos_rls ON public.erp_produtos;
CREATE POLICY erp_produtos_rls ON public.erp_produtos FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · balanco_patrimonial (client-direct: BalancoPatrimonial.tsx, IndicadoresFinanceiros.tsx)
--     Derruba as policies dormentes abertas: allow_all_bp (qual=true) e bp_all (user_company_ids(),
--     subconjunto de get_user_company_ids()). Mantém só a canônica (RD-52 fonte única).
ALTER TABLE public.balanco_patrimonial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_bp ON public.balanco_patrimonial;
DROP POLICY IF EXISTS bp_all ON public.balanco_patrimonial;
DROP POLICY IF EXISTS balanco_patrimonial_rls ON public.balanco_patrimonial;
CREATE POLICY balanco_patrimonial_rls ON public.balanco_patrimonial FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3 · cost_allocations (client-direct: custeio/page.tsx; insert via API custos/processar = SERVICE_ROLE)
ALTER TABLE public.cost_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_allocations_rls ON public.cost_allocations;
CREATE POLICY cost_allocations_rls ON public.cost_allocations FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 4 · bpo_conversas (client-direct: bpo/conversas/[id] buscava por id SEM company_id → RLS fecha o buraco)
ALTER TABLE public.bpo_conversas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpo_conversas_rls ON public.bpo_conversas;
CREATE POLICY bpo_conversas_rls ON public.bpo_conversas FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 5 · erp_fechamento_periodo (sem query client-direct em src/ → RPC/admin; defense-in-depth)
ALTER TABLE public.erp_fechamento_periodo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_fechamento_periodo_rls ON public.erp_fechamento_periodo;
CREATE POLICY erp_fechamento_periodo_rls ON public.erp_fechamento_periodo FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 6 · api_integrations · SEGREDOS (api_key_encrypted). Já existia policy api_all (qual=is_admin(), public).
--     LIGAMOS RLS mantendo SÓ is_admin() — NÃO usar company_id (deixaria qualquer usuário da empresa ler o
--     segredo). Leitura server (omie sync) usa SERVICE_ROLE → bypassa. NÃO recriar/derrubar api_all.
ALTER TABLE public.api_integrations ENABLE ROW LEVEL SECURITY;

-- 7 · rateio_distribuicao_calculado (sem query client-direct em src/ → RPC/admin; defense-in-depth)
ALTER TABLE public.rateio_distribuicao_calculado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rateio_distribuicao_calculado_rls ON public.rateio_distribuicao_calculado;
CREATE POLICY rateio_distribuicao_calculado_rls ON public.rateio_distribuicao_calculado FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 8 · erp_entity_mapping (sem query client-direct em src/ → RPC/admin; defense-in-depth)
ALTER TABLE public.erp_entity_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_entity_mapping_rls ON public.erp_entity_mapping;
CREATE POLICY erp_entity_mapping_rls ON public.erp_entity_mapping FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
