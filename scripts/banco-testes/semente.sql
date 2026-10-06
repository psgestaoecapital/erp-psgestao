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
-- Catálogo de planos (dado de REFERÊNCIA, não de cliente): o dump traz só a estrutura, e fn_demo_garantir_plano
-- (chamada por fn_demo_reset) cria tenant_subscriptions com FK para plan_catalog. Só os planos das empresas demo.
INSERT INTO public.plan_catalog (id, nome, ativo, legacy, vertical, descricao, sla_level, plan_group, billing_model, tier_internal, is_replacement)
VALUES
  ('v15_oficina_grande','Oficina Grande',true,false,'oficina','Oficina mecânica 15+ mecânicos','enterprise','transacional_pesado','mensal_fixo','grande',true),
  ('v15_pm_grande','P&M Grande',true,false,'pm','ERP agência/produtora grande','enterprise','hibrido','mensal_fixo','grande',true),
  ('v15_revenda','Revenda de Veículos',true,false,'revenda_veiculos','ERP para revenda de veículos','basic','recorrente_leve','mensal_fixo',NULL,false),
  ('v15_gestao_empresarial_pro','Gestão Empresarial Pró',true,false,'gestao_empresarial','Gestão Empresarial Pró','pro','gestao_empresarial','mensal_fixo','pro',true),
  ('v15_compliance','Compliance',true,false,'compliance','Gestão obrigações trabalhistas/fiscais','pro','horizontal','por_funcionario',NULL,false)
ON CONFLICT (id) DO NOTHING;
COMMIT;
