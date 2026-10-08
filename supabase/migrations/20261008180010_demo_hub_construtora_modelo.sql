-- Hub · empresa de demonstração própria "Construtora Modelo - DEMO" (Eng. Chefe/CEO 08/10).
-- Só a EMPRESA: sem dado de cadastro. O CEO preenche de ponta a ponta pela tela (cliente, serviços, mão de obra,
-- proposta, obra); o seed complementar vem depois e nunca sobrescreve o que foi criado pela tela.
--  • companies b0700000-…-006 (is_demo, ambiente 'auditoria', CNPJ fictício, construção/empreiteira)
--  • plano igual ao da Tryo Gesso: Hub T1 + Gestão Empresarial Pro, a R$ 0 (demo fica fora do MRR)
--  • acesso: CEO, equipe PS (sócios) e robô (mesmos papéis das outras demos)
--  • demo_por_area('hub') passa a apontar para ela (fn_demo_da_area lê esta tabela)
-- Aditiva e idempotente; não toca em nenhuma empresa real.

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj,
                              restrita_ps_admin, uf_fiscal, cidade_estado, setor, company_type)
VALUES ('b0700000-0000-4000-a000-000000000006', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Construtora Modelo LTDA', 'Construtora Modelo - DEMO',
        true, 'auditoria', '55500000000223', false, 'SC', 'Chapecó/SC', 'Construção e empreiteira', 'servico')
ON CONFLICT (id) DO UPDATE SET
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000006', p.plano, 'active', 0, 'monthly', p.tier,
       'Demonstração do Hub · plano igual ao da Tryo Gesso a R$ 0'
FROM (VALUES ('v15_hub_t1', 'T1'), ('v15_gestao_empresarial_pro', NULL)) AS p(plano, tier)
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE)
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions s
                  WHERE s.company_id = 'b0700000-0000-4000-a000-000000000006' AND s.plan_id = p.plano AND s.status = 'active');

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

INSERT INTO public.demo_por_area (area, company_id)
VALUES ('hub', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
