-- DEMO do Hub (CEO 08/10): empresa "Construtora Modelo - DEMO", só a EMPRESA (sem dado de cadastro).
-- O CEO preenche de ponta a ponta pela tela (cliente, serviços, mão de obra, proposta, obra); o seed
-- complementar vem depois e não sobrescreve o que a tela criar.
-- Aditiva: empresa nova (is_demo), planos R$ 0 (Hub T1 + Gestão Empresarial Pro, como a Tryo), acesso do CEO,
-- da equipe PS e do robô, e demo_por_area para 'hub' / 'hub_construcao' (fn_demo_da_area('hub') passa a apontar).

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-000000000006', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Construtora Modelo LTDA', 'Construtora Modelo - DEMO',
        true, 'auditoria', '55500000000223', false, 'SC')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000006', m.plano, 'active', 0, 'monthly', m.tier, 'Demonstração · Hub + Gestão Empresarial R$ 0'
FROM (VALUES ('v15_hub_t1', 'T1'), ('v15_gestao_empresarial_pro', 'pro')) AS m(plano, tier)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions t
  WHERE t.company_id = 'b0700000-0000-4000-a000-000000000006' AND t.plan_id = m.plano AND t.status = 'active');

INSERT INTO public.user_companies (user_id, company_id, role)
SELECT u.id, 'b0700000-0000-4000-a000-000000000006', u.papel
FROM (VALUES ('4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, 'acesso_total'),
             ('43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, 'acesso_total'),
             ('33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, 'acesso_total'),
             ('f3867e65-94d6-43c0-aeb9-8da82fcfe433'::uuid, 'acesso_total'),
             ('74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid, 'adm')) AS u(id, papel)
WHERE EXISTS (SELECT 1 FROM public.users x WHERE x.id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.user_companies uc
                  WHERE uc.user_id = u.id AND uc.company_id = 'b0700000-0000-4000-a000-000000000006');

INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('hub',           'b0700000-0000-4000-a000-000000000006'),
  ('hub_construcao','b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
