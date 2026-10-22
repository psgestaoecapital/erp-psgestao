-- CEO 08/10 (caixa ec379e7b): empresa de demonstração própria do Hub de Projetos — "Construtora Modelo - DEMO".
-- Só a EMPRESA (sem dado de cadastro): o CEO preenche de ponta a ponta pela tela (diagnóstico com o Claude no Chrome);
-- o seed completo vem depois como complemento e não sobrescreve o que for criado pela tela.
--   1) companies b0700000-…-0006 (is_demo, ambiente 'auditoria', CNPJ com DV válido e não-colidente).
--   2) Planos iguais aos da Tryo (Hub T1 + Gestão Empresarial Pro), R$ 0, fora do MRR (fn_empresas_produtivas exclui demo).
--   3) Acesso: robô, CEO e equipe PS (mesmos vínculos da demo GE).
--   4) demo_por_area: 'hub' e 'hub_construcao' passam da demo GE para a Construtora Modelo.
-- Aditiva e idempotente: nada é apagado; empresa real nenhuma muda.

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-000000000006', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Construtora Modelo Demonstração LTDA', 'Construtora Modelo - DEMO',
        true, 'auditoria', '55500000000223', false, 'SC')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false, cnpj = EXCLUDED.cnpj;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000006', p.plan_id, 'active', 0, 'monthly', p.tier,
       'Demonstração · CEO 08/10 (Construtora Modelo, plano igual ao da Tryo)'
FROM (VALUES ('v15_hub_t1', 'T1'), ('v15_gestao_empresarial_pro', 'pro')) AS p(plan_id, tier)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                  WHERE ts.company_id = 'b0700000-0000-4000-a000-000000000006' AND ts.plan_id = p.plan_id);

-- acesso: mesmos vínculos da demo GE (robô, CEO, equipe PS)
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000006', uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                  WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-000000000006');

-- fn_demo_da_area('hub') e ('hub_construcao') → Construtora Modelo (o guard exige is_demo)
INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('hub',            'b0700000-0000-4000-a000-000000000006'),
  ('hub_construcao', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
