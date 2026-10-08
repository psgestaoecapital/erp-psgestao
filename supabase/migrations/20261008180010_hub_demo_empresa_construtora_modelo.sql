-- Hub · empresa de demonstração "Construtora Modelo - DEMO" (CEO 08/10, mensagem ec379e7b).
-- Só a EMPRESA (sem dado de cadastro): o CEO preenche pela tela, de ponta a ponta, como teste real do fluxo.
-- O seed complementar do Hub (mensagem 8ec1da75) não pode sobrescrever o que for criado pela tela.
--
-- Empresa b0700000-0000-4000-a000-000000000006 (is_demo, CNPJ com DV válido), plano igual ao da Tryo
-- (v15_hub_t1 + v15_gestao_empresarial_pro, R$ 0 — fora do MRR: fn_empresas_produtivas exclui demo),
-- acesso do CEO, equipe PS e robô, e demo_por_area 'hub' / 'hub_construcao' apontando para ela.
-- Aditiva: nenhuma tabela/função alterada; só linhas novas da demo e a troca do ponteiro das 2 áreas do Hub.

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal,
                              company_type, tipo_empresa, setor, regime_tributario, is_active)
VALUES ('b0700000-0000-4000-a000-000000000006', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Construtora Modelo Demonstração LTDA', 'Construtora Modelo - DEMO',
        true, 'auditoria', '55500000000657', false, 'SC',
        'servico', 'matriz', 'Construção / Empreiteira', 'simples_nacional', true)
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl)
SELECT 'b0700000-0000-4000-a000-000000000006', p.plan_id, 'active', 0
FROM (VALUES ('v15_hub_t1'), ('v15_gestao_empresarial_pro')) AS p(plan_id)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions s
                  WHERE s.company_id = 'b0700000-0000-4000-a000-000000000006' AND s.plan_id = p.plan_id);

-- CEO, equipe PS e robô (mesmos usuários/papéis da demo GE)
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000006', uc.role
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND EXISTS (SELECT 1 FROM public.users x WHERE x.id = uc.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.user_companies y
                  WHERE y.user_id = uc.user_id AND y.company_id = 'b0700000-0000-4000-a000-000000000006');

INSERT INTO public.demo_por_area (area, company_id)
VALUES ('hub', 'b0700000-0000-4000-a000-000000000006'),
       ('hub_construcao', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
