-- Hub · empresa de demonstração própria "Construtora Modelo - DEMO" (Eng. Chefe 08/10, msg ec379e7b).
-- Até aqui fn_demo_da_area('hub') apontava para "Comércio (GE) - DEMO", sem dado de Hub (catálogo vazio, painel zerado).
-- Esta migration cria SÓ a empresa (sem dado de cadastro: o CEO preenche pela tela, e o seed de complemento vem depois
-- sem sobrescrever o que for criado). Aditiva: empresa NOVA, assinaturas NOVAS (R$ 0, fora do MRR), acessos e demo_por_area.
-- Plano igual ao da Tryo para o Hub + Gestão Empresarial: v15_hub_t1 (T1) e v15_gestao_empresarial_pro.
-- Acesso: os mesmos usuários da demo GE (CEO, equipe PS e robô).

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, restrita_ps_admin, uf_fiscal, setor, company_type)
VALUES ('b0700000-0000-4000-a000-000000000006', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Construtora Modelo LTDA', 'Construtora Modelo - DEMO',
        true, 'auditoria', false, 'SC', 'Construção civil / empreiteira', 'servico')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000006', v.plano, 'active', 0, 'monthly', v.tier,
       'Demonstração · plano igual ao da Tryo, R$ 0'
FROM (VALUES ('v15_hub_t1', 'T1'), ('v15_gestao_empresarial_pro', 'pro')) AS v(plano, tier)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions t
                  WHERE t.company_id = 'b0700000-0000-4000-a000-000000000006' AND t.plan_id = v.plano AND t.status = 'active');

-- acesso: mesma equipe da demo GE (CEO, PS, robô)
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000006', uc.role
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                  WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-000000000006');

-- o robô e o seletor passam a usar a demo própria nas áreas do Hub
UPDATE public.demo_por_area SET company_id = 'b0700000-0000-4000-a000-000000000006'
WHERE area IN ('hub', 'hub_construcao');
INSERT INTO public.demo_por_area (area, company_id)
SELECT a, 'b0700000-0000-4000-a000-000000000006' FROM unnest(ARRAY['hub', 'hub_construcao']) a
WHERE NOT EXISTS (SELECT 1 FROM public.demo_por_area d WHERE d.area = a);
