-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EHS-F(d) · Empresa DEMO "EHS + Financeiro - DEMO" (Compliance + Gestão Empresarial acoplado)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CEO 20/11/2026 (prioridade máxima; sociedade SOS; erp_contexto_projeto d28ad208): o PS EHS vende sozinho e quem quiser
-- contrata o Financeiro (Gestão Empresarial) acoplado. A onda EHS-F (Parte F.2) precisa de uma 2ª DEMO para provar os
-- DOIS estados lado a lado: "EHS Modelo - DEMO" (…b, só Compliance) × "EHS + Financeiro - DEMO" (…c, Compliance + GE).
--
-- PROVA ARQUITETURAL (RD-38, produção, antes desta migration): a "combinação v15_compliance + plano GE" da spec EHS-F(a)
-- NÃO exige pacote novo — o modelo de assinatura já permite múltiplos planos ativos por empresa
-- (ex.: …005 = v15_compliance + v15_industrial_grande; 918c3ea4 = v15_hub_t1 + v15_compliance + v15_gestao_empresarial_pro).
-- Logo, "EHS + Financeiro" = assinatura dupla (v15_compliance + v15_gestao_empresarial_pro), liberação por plano/módulo,
-- nunca por código (F.2). Esta migration só materializa a 2ª DEMO; NÃO cria/altera plano nem módulo.
--
-- Modelo: 20261122090040_ehs0a_demo_ehs_empresa.sql (EHS-0(a), …b). Mesmos 4 passos, agora com 2 assinaturas.
-- SEGURANÇA/ESCOPO: 100% aditiva e idempotente; só o ambiente DEMO/auditoria (is_demo=true). NÃO toca dado de cliente,
-- NÃO altera RLS/policies/grants, NÃO apaga nada. 'ehs' (…b), 'compliance'/'industria' (…005) seguem intocados.
--
-- Prova RD-38 (produção, BEGIN…ROLLBACK, statement_timeout curto — não grava):
--   empresa=1 · subs=2 (v15_compliance, v15_gestao_empresarial_pro) ·
--   vínculos=6 (5 herdados da …005 + 1 auto, igual à …b) · demo_por_area ehs_financeiro→…c.

-- 1) Empresa DEMO (mesma org das demais DEMOs; ambiente de auditoria; CNPJ fictício exclusivo)
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-00000000000c', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'EHS mais Financeiro Demonstração LTDA', 'EHS + Financeiro - DEMO', true, 'auditoria', '55500000000673', false, 'SC')
ON CONFLICT (id) DO NOTHING;

-- 2) Assinaturas: Compliance (PS EHS) + Gestão Empresarial Pró (Financeiro acoplado) — prova "os dois estados"
INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-00000000000c'::uuid, p.plan_id, 'active', 0, 'monthly', 'pro', p.obs
FROM (VALUES
        ('v15_compliance',             'Demonstração · PS EHS + Financeiro (Compliance)'),
        ('v15_gestao_empresarial_pro', 'Demonstração · PS EHS + Financeiro (Gestão Empresarial acoplado)')
     ) AS p(plan_id, obs)
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000c')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                   WHERE ts.company_id = 'b0700000-0000-4000-a000-00000000000c' AND ts.plan_id = p.plan_id);

-- 3) Acesso: os mesmos vínculos da DEMO Indústria (…005), de onde veio o EHS (robô, CEO, equipe PS)
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-00000000000c'::uuid, uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000005'
  AND EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000c')
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                   WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-00000000000c');

-- 4) Ponteiro de demonstração: área nova 'ehs_financeiro' → a 2ª DEMO.
--    ('ehs' segue na …b, 'compliance'/'industria' na …005 — nenhum ponteiro existente é tocado.)
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('ehs_financeiro', 'b0700000-0000-4000-a000-00000000000c')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
