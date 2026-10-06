-- Semente mínima do BANCO DE TESTES (nunca rodar em produção). Idempotente.
-- Empresa DEMO = a mesma da aceitação (e2e/support/api.ts › DEMO_REVENDA). Parâmetro: -v bot_email=... 
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE v_org uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000003') THEN
    SELECT id INTO v_org FROM public.organizations LIMIT 1;
    IF v_org IS NULL THEN
      INSERT INTO public.organizations (name, slug) VALUES ('PS Gestão (testes)', 'ps-gestao-testes') RETURNING id INTO v_org;
    END IF;
    INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
    VALUES ('b0700000-0000-4000-a000-000000000003', v_org, 'Demonstração Revenda', 'Demonstração Revenda', true, 'producao');
  END IF;
END $$;
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT u.id, 'b0700000-0000-4000-a000-000000000003', 'admin'
FROM auth.users u WHERE lower(u.email) = lower(:'bot_email')
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x WHERE x.user_id = u.id AND x.company_id = 'b0700000-0000-4000-a000-000000000003');
COMMIT;
