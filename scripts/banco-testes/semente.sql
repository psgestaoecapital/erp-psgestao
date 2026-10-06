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
      INSERT INTO public.organizations (name, slug) VALUES ('PS Gestão (testes)', 'ps-gestao-testes')
      ON CONFLICT (slug) DO NOTHING;
      SELECT id INTO v_org FROM public.organizations WHERE slug = 'ps-gestao-testes';
    END IF;
    INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
    VALUES ('b0700000-0000-4000-a000-000000000003', v_org, 'Demonstração Revenda', 'Demonstração Revenda', true, 'producao')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT u.id, 'b0700000-0000-4000-a000-000000000003', 'admin'
FROM auth.users u WHERE lower(u.email) = lower(:'bot_email')
  ON CONFLICT (user_id, company_id) DO NOTHING;
-- plan_catalog é DADO (o dump leva só estrutura): fn_demo_garantir_plano faz FK para o plano da demo (run #8: v15_revenda ausente).
INSERT INTO public.plan_catalog (id, nome, max_usuarios, max_empresas, ativo, plan_group, billing_model, vertical, legacy)
VALUES ('v15_revenda', 'Revenda de Veículos', 5, 1, true, 'recorrente_leve', 'mensal_fixo', 'revenda_veiculos', false)
ON CONFLICT (id) DO NOTHING;
COMMIT;
