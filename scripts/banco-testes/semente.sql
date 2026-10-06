-- Semente mínima do banco de testes (erp-psgestao-testes). Idempotente. NUNCA rodar em produção.
-- Empresa Demonstração Revenda (id fixo que as specs esperam: e2e/support/api.ts › DEMO_REVENDA).
-- Parâmetro: -v bot_uid=<uuid do usuário do Playwright no Auth do banco de testes>
BEGIN;
INSERT INTO organizations (id, name, slug)
VALUES ('b0700000-0000-4000-a000-000000000001', 'PS Testes', 'ps-testes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO companies (id, org_id, razao_social, nome_fantasia, is_active, is_demo)
VALUES ('b0700000-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000001',
        'Demonstração Revenda', 'Demonstração Revenda', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_companies (user_id, company_id, role)
SELECT :'bot_uid'::uuid, 'b0700000-0000-4000-a000-000000000003', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM user_companies
                  WHERE user_id = :'bot_uid'::uuid AND company_id = 'b0700000-0000-4000-a000-000000000003');
COMMIT;
