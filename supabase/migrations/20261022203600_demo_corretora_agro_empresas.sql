-- PDCA · DEMO por vertical (CEO 09/10, caixa 0c4baabe, gilberto-chamados): faltavam as empresas de demonstração de
-- Corretora e Agro. Esta migration cria SÓ as empresas, o acesso e o demo_por_area (mesmo padrão da Construtora Modelo,
-- 20261008180010). O seed reparável (fn_gold_*_seed_reparar) vem na próxima fatia, depois de mapear as tabelas de cada vertical.
--   b0700000-…-0008 "Corretora Modelo - DEMO"  → áreas 'corretora', 'corretora_seguros'
--   b0700000-…-0009 "Fazenda Modelo - DEMO"    → áreas 'agro', 'agronegocio'
-- CNPJ da Corretora = ...0385: o ...0304 já é da Loja Modelo - DEMO (companies_cnpj_key; deploy-migrations vermelho em 22/10).
-- Aditiva e idempotente: nada é apagado; empresa real nenhuma muda; R$ 0, fora do MRR (demo).

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES
  ('b0700000-0000-4000-a000-000000000008', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
   'Corretora Modelo Demonstração LTDA', 'Corretora Modelo - DEMO', true, 'auditoria', '55500000000385', false, 'SC'),
  ('b0700000-0000-4000-a000-000000000009', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
   'Fazenda Modelo Demonstração LTDA', 'Fazenda Modelo - DEMO', true, 'auditoria', '55500000000495', false, 'PR')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false, cnpj = EXCLUDED.cnpj;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT p.company_id::uuid, p.plan_id, 'active', 0, 'monthly', p.tier, 'Demonstração · PDCA DEMO por vertical (CEO 09/10)'
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000008', 'v15_gestao_empresarial_pro', 'pro'),
  ('b0700000-0000-4000-a000-000000000009', 'v15_gestao_empresarial_pro', 'pro'),
  ('b0700000-0000-4000-a000-000000000009', 'v15_agro', 'pro')
) AS p(company_id, plan_id, tier)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                  WHERE ts.company_id = p.company_id::uuid AND ts.plan_id = p.plan_id);

-- acesso: mesmos vínculos da demo GE (robô, CEO, equipe PS)
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, d.id, uc.role, uc.origem
FROM public.user_companies uc
CROSS JOIN (VALUES ('b0700000-0000-4000-a000-000000000008'::uuid), ('b0700000-0000-4000-a000-000000000009'::uuid)) AS d(id)
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x WHERE x.user_id = uc.user_id AND x.company_id = d.id);

INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('corretora',         'b0700000-0000-4000-a000-000000000008'),
  ('corretora_seguros', 'b0700000-0000-4000-a000-000000000008'),
  ('agro',              'b0700000-0000-4000-a000-000000000009'),
  ('agronegocio',       'b0700000-0000-4000-a000-000000000009')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
