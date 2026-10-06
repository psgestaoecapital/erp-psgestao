-- Semente mínima do BANCO DE TESTES (nunca rodar em produção). Empresa DEMO Revenda + usuário do Playwright.
-- Parâmetros psql: -v bot_id=<uuid do auth.users> -v bot_email=<email>
SET statement_timeout = '30s';
DO $$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organizations LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO organizations DEFAULT VALUES RETURNING id INTO v_org;
  END IF;
  INSERT INTO companies (id, org_id, razao_social, nome_fantasia, is_active, is_demo)
  VALUES ('b0700000-0000-4000-a000-000000000003', v_org, 'Demonstração Revenda (testes)', 'Demonstração Revenda', true, true)
  ON CONFLICT (id) DO NOTHING;
END $$;
INSERT INTO users (id, full_name, email, role, is_active)
VALUES (:'bot_id', 'Robô Playwright (testes)', :'bot_email', 'admin', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_companies (user_id, company_id, role)
SELECT :'bot_id', 'b0700000-0000-4000-a000-000000000003', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = :'bot_id' AND company_id = 'b0700000-0000-4000-a000-000000000003');
