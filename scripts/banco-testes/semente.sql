-- Semente mínima do BANCO DE TESTES (nunca rodar em produção). Idempotente (rodar 2x dá o mesmo estado).
-- Forma copiada da produção só-leitura (06/10): 6 empresas is_demo (b0700000-…-001..005 em 'auditoria' + ded00000-…-001
-- 'demo'), plano ativo em cada uma, o usuário do Playwright como 'adm' em user_companies de todas e CLIENT_OWNER em
-- tenant_user_roles da ded0…001 (as outras não têm tenant_user_roles). Nenhum dado de cliente.
-- Parâmetro: -v bot_email=...
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO public.organizations (name, slug) VALUES ('PS Gestão (testes)', 'ps-gestao-testes')
    ON CONFLICT (slug) DO NOTHING;
    SELECT id INTO v_org FROM public.organizations WHERE slug = 'ps-gestao-testes';
  END IF;

  -- is_demo = true SEMPRE (inclusive quando a empresa já existe com is_demo falso: a aceitação só roda em demo)
  INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
  SELECT d.id, v_org, d.nome, d.nome, true, d.ambiente
  FROM (VALUES
    ('b0700000-0000-4000-a000-000000000001'::uuid, 'Demonstração Oficina',   'auditoria'),
    ('b0700000-0000-4000-a000-000000000002'::uuid, 'Demonstração P&M',       'auditoria'),
    ('b0700000-0000-4000-a000-000000000003'::uuid, 'Demonstração Revenda',   'auditoria'),
    ('b0700000-0000-4000-a000-000000000004'::uuid, 'Demonstração Gestão Empresarial', 'auditoria'),
    ('b0700000-0000-4000-a000-000000000005'::uuid, 'Demonstração Indústria SST',      'auditoria'),
    ('b0700000-0000-4000-a000-000000000006'::uuid, 'Construtora Modelo - DEMO',        'auditoria'),
    ('ded00000-0000-4000-a000-000000000001'::uuid, 'Demonstração Mecânica',  'demo')
  ) AS d(id, nome, ambiente)
  ON CONFLICT (id) DO UPDATE SET is_demo = true, ambiente_tenant = EXCLUDED.ambiente_tenant, is_active = true;
END $$;

-- plano ativo de cada demo (plan_catalog vem da whitelist de catálogos, que roda antes da semente)
INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl)
SELECT p.company_id, p.plan_id, 'active', 0
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000001'::uuid, 'v15_oficina_grande'),
  ('b0700000-0000-4000-a000-000000000002'::uuid, 'v15_pm_grande'),
  ('b0700000-0000-4000-a000-000000000003'::uuid, 'v15_revenda'),
  ('b0700000-0000-4000-a000-000000000004'::uuid, 'v15_gestao_empresarial_pro'),
  ('b0700000-0000-4000-a000-000000000004'::uuid, 'v15_hub_t1'),
  ('b0700000-0000-4000-a000-000000000005'::uuid, 'v15_compliance'),
  ('b0700000-0000-4000-a000-000000000006'::uuid, 'v15_hub_t1'),
  ('b0700000-0000-4000-a000-000000000006'::uuid, 'v15_gestao_empresarial_pro'),
  ('ded00000-0000-4000-a000-000000000001'::uuid, 'v15_oficina_grande')
) AS p(company_id, plan_id)
WHERE EXISTS (SELECT 1 FROM public.plan_catalog c WHERE c.id = p.plan_id)
  AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions s
                  WHERE s.company_id = p.company_id AND s.plan_id = p.plan_id);
UPDATE public.tenant_subscriptions SET status = 'active'
WHERE company_id IN ('b0700000-0000-4000-a000-000000000001','b0700000-0000-4000-a000-000000000002',
                     'b0700000-0000-4000-a000-000000000003','b0700000-0000-4000-a000-000000000004',
                     'b0700000-0000-4000-a000-000000000005','b0700000-0000-4000-a000-000000000006','ded00000-0000-4000-a000-000000000001')
  AND status IS DISTINCT FROM 'active';

-- usuário do Playwright: 'adm' em todas as demos (igual à produção) ...
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT u.id, c.id, 'adm'
FROM auth.users u
CROSS JOIN public.companies c
WHERE lower(u.email) = lower(:'bot_email') AND c.is_demo
ON CONFLICT (user_id, company_id) DO UPDATE SET role = 'adm';

-- public.users: tenant_user_roles.user_id referencia public.users(id), e no banco de testes o gatilho do auth.users não
-- cria a linha (o role 'geral' do default viola users_role_check, então 'adm' é explícito)
INSERT INTO public.users (id, full_name, email, role, is_robo)
SELECT u.id, 'Robô Playwright (testes)', u.email, 'adm', true
FROM auth.users u WHERE lower(u.email) = lower(:'bot_email')
ON CONFLICT DO NOTHING;

-- ... e CLIENT_OWNER ativo na ded0…001 (a única demo com tenant_user_roles na produção)
INSERT INTO public.tenant_user_roles (user_id, company_id, role, is_active)
SELECT u.id, 'ded00000-0000-4000-a000-000000000001', 'CLIENT_OWNER', true
FROM auth.users u WHERE lower(u.email) = lower(:'bot_email')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_user_roles t
                  WHERE t.user_id = u.id AND t.company_id = 'ded00000-0000-4000-a000-000000000001' AND t.role = 'CLIENT_OWNER');
UPDATE public.tenant_user_roles t SET is_active = true
FROM auth.users u
WHERE t.user_id = u.id AND lower(u.email) = lower(:'bot_email')
  AND t.company_id = 'ded00000-0000-4000-a000-000000000001' AND t.role = 'CLIENT_OWNER' AND NOT t.is_active;

-- trava da demo: nenhuma lease herdada de run que falhou/cancelou (a tabela só existe depois do restore)
DO $$ BEGIN
  IF to_regclass('public.e2e_trava') IS NOT NULL THEN DELETE FROM public.e2e_trava; END IF;
END $$;
COMMIT;
