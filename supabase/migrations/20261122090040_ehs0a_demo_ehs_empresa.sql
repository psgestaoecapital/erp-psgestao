-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EHS-0(a) · Empresa DEMO "EHS Modelo - DEMO" (só o plano Compliance) + acesso + ponteiro de área 'ehs'
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CEO 20/11/2026 (prioridade máxima, erp_contexto_projeto d28ad208): a área PS EHS precisa da sua própria DEMO.
-- Esta é a fatia-base (EHS-0 item a) que destrava os outros devs da vertical EHS — cria a empresa de demonstração,
-- assina SÓ o plano Compliance (prova "só Admin + PS EHS"), replica o acesso da DEMO Indústria (…005, de onde o EHS
-- nasceu) e move o ponteiro de demonstração da área 'ehs' para a nova empresa.
--
-- Modelo: bloco 12 de 20261118170040_crm_vertical_onda1.sql (DEMO CRM …a).
-- SEGURANÇA/ESCOPO: 100% aditiva e idempotente; só o ambiente DEMO/auditoria (is_demo=true). NÃO toca dado de cliente,
-- NÃO altera RLS/policies/grants, NÃO apaga nada. 'compliance' e 'industria' CONTINUAM apontando para a …005 (o spec
-- e2e/jornadas/aceitacao/demo-industria-sst.spec.ts lê demo_por_area('compliance') → …005 e seria quebrado se mudasse).
--
-- Prova RD-38 (produção, BEGIN…ROLLBACK, statement_timeout curto — não grava):
--   empresa=1 · subs=1 (v15_compliance) · vínculos_ehs=6 (herdados da …005 + auto) ·
--   demo_por_area ehs→…b, compliance→…005, industria→…005 ·
--   fn_modulos_sidebar_por_area('compliance', …b, robô) = 23 itens (menu PS EHS NÃO fica vazio) · ('ehs') = 0 (slug de rota, não de menu).

-- 1) Empresa DEMO EHS (mesma org das demais DEMOs; ambiente de auditoria; CNPJ fictício exclusivo)
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-00000000000b', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'EHS Modelo Demonstração LTDA', 'EHS Modelo - DEMO', true, 'auditoria', '55500000000592', false, 'SC')
ON CONFLICT (id) DO NOTHING;

-- 2) Assinatura: SÓ o plano Compliance (gera o menu PS EHS e nada mais — prova "só Admin + PS EHS")
INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-00000000000b'::uuid, 'v15_compliance', 'active', 0, 'monthly', 'pro',
       'Demonstração · PS EHS (plano Compliance sozinho)'
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000b')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                   WHERE ts.company_id = 'b0700000-0000-4000-a000-00000000000b' AND ts.plan_id = 'v15_compliance');

-- 3) Acesso: os mesmos vínculos da DEMO Indústria (…005), de onde veio o EHS (robô, CEO, equipe PS)
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-00000000000b'::uuid, uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000005'
  AND EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-00000000000b')
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                   WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-00000000000b');

-- 4) Ponteiro de demonstração: SÓ a área 'ehs' passa para a nova DEMO.
--    ('compliance' e 'industria' seguem na …005 — specs dependem; não são tocados aqui.)
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('ehs', 'b0700000-0000-4000-a000-00000000000b')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
