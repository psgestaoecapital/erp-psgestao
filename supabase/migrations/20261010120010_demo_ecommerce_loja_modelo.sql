-- EC0 (caixa 26fd9c69, CEO 08/10): empresa de demonstração "Loja Modelo - DEMO" da vertical E-commerce.
-- Só a EMPRESA (sem dado) + acesso + fn_demo_da_area('ecommerce'). Mesmo padrão da Construtora Modelo (…06).
-- Aditiva e idempotente: nada é apagado; empresa real nenhuma muda.

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-000000000007', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Loja Modelo Demonstração LTDA', 'Loja Modelo - DEMO',
        true, 'auditoria', '55500000000304', false, 'SC')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false, cnpj = EXCLUDED.cnpj;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000007', 'v15_gestao_empresarial_pro', 'active', 0, 'monthly', 'pro',
       'Demonstração · EC0 (Loja Modelo, GE; módulo E-commerce entra com a área no menu)'
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                  WHERE ts.company_id = 'b0700000-0000-4000-a000-000000000007' AND ts.plan_id = 'v15_gestao_empresarial_pro');

INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000007', uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                  WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-000000000007');

INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('ecommerce', 'b0700000-0000-4000-a000-000000000007')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
