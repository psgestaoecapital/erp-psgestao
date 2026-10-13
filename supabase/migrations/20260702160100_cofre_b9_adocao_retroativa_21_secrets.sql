-- Catalogo os 21 vault.secrets existentes em erp_credencial. Sem re-cifrar.
-- fn_banco_* continuam lendo direto do Vault como sempre — o Cofre é so trilha.
-- IO Point ficou por-empresa (mesmo provider+chave, company_id resolve unique).
-- Aplicada via MCP em 2026-07-02.

-- Globais (SCREAMING_SNAKE)
INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label) VALUES
  ('anthropic',       'api_key',       'global', NULL, 'ANTHROPIC_API_KEY',                'Anthropic API'),
  ('auditor_gold',    'email',         'global', NULL, 'AUDITOR_GOLD_EMAIL',               'Auditor Gold login'),
  ('auditor_gold',    'password',      'global', NULL, 'AUDITOR_GOLD_PASSWORD',            'Auditor Gold senha'),
  ('brapi',           'api_token',     'global', NULL, 'BRAPI_API_TOKEN',                  'Brapi cotações'),
  ('pluggy',          'client_id',     'global', NULL, 'PLUGGY_CLIENT_ID',                 'Pluggy Open Finance'),
  ('pluggy',          'client_secret', 'global', NULL, 'PLUGGY_CLIENT_SECRET',             'Pluggy Open Finance'),
  ('supabase',        'access_token',  'global', NULL, 'SUPABASE_ACCESS_TOKEN_DEPLOY',     'Supabase deploy'),
  ('supabase',        'service_role',  'global', NULL, 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER', 'Worker Supabase service role')
ON CONFLICT DO NOTHING;

-- IO Point (por empresa — vault.secrets tem nome legado com sufixo empresa)
INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label) VALUES
  ('iopoint','token','empresa','975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid,
    'IOPOINT_TOKEN_FRIOESTE',         'IO Point Frioeste'),
  ('iopoint','token','empresa','50b1da9b-7367-4489-8b50-e62dd6efc760'::uuid,
    'IOPOINT_TOKEN_TRYO_ACABAMENTOS', 'IO Point Tryo Acabamentos'),
  ('iopoint','token','empresa','918c3ea4-770d-4a10-9200-f9c21f92a1f6'::uuid,
    'IOPOINT_TOKEN_TRYO_GESSOS',      'IO Point Tryo Gesso')
ON CONFLICT DO NOTHING;

-- Focus NFe (por empresa)
INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label) VALUES
  ('focus', 'token_homolog', 'empresa', 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'::uuid,
    'focus_token_homolog_b2b96eef-0ad9-4588-85c1-a4e9f2cd7490', 'Focus NFe homolog'),
  ('focus', 'token_homolog', 'empresa', 'd1330faf-78f8-40fc-904f-711a6e4b7352'::uuid,
    'focus_token_homolog_d1330faf-78f8-40fc-904f-711a6e4b7352', 'Focus NFe homolog'),
  ('focus', 'token_prod',    'empresa', 'a462e13f-0f51-4c54-abe8-4474b591633b'::uuid,
    'focus_token_prod_a462e13f-0f51-4c54-abe8-4474b591633b',    'Focus NFe produção'),
  ('focus', 'token_prod',    'empresa', 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid,
    'focus_token_prod_b26c19c0-bf6d-495b-b8d1-9fa8d6896725',    'Focus NFe produção')
ON CONFLICT DO NOTHING;

-- Banco Sicoob/Bradesco (por empresa+ambiente)
INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label) VALUES
  ('banco_bradesco_prod',  'certpw',    'empresa', 'd1330faf-78f8-40fc-904f-711a6e4b7352'::uuid,
    'banco_bradesco_producao_d1330faf-78f8-40fc-904f-711a6e4b7352_certpw',    'Bradesco produção · senha do cert'),
  ('banco_bradesco_prod',  'clisecret', 'empresa', 'd1330faf-78f8-40fc-904f-711a6e4b7352'::uuid,
    'banco_bradesco_producao_d1330faf-78f8-40fc-904f-711a6e4b7352_clisecret', 'Bradesco produção · client secret'),
  ('banco_sicoob_homolog', 'cert',      'empresa', 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid,
    'banco_sicoob_homologacao_b26c19c0-bf6d-495b-b8d1-9fa8d6896725_cert',     'Sicoob homologação · cert A1'),
  ('banco_sicoob_homolog', 'certpw',    'empresa', 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid,
    'banco_sicoob_homologacao_b26c19c0-bf6d-495b-b8d1-9fa8d6896725_certpw',   'Sicoob homologação · senha do cert'),
  ('banco_sicoob_prod',    'cert',      'empresa', 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid,
    'banco_sicoob_producao_b26c19c0-bf6d-495b-b8d1-9fa8d6896725_cert',        'Sicoob produção · cert A1'),
  ('banco_sicoob_prod',    'certpw',    'empresa', 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid,
    'banco_sicoob_producao_b26c19c0-bf6d-495b-b8d1-9fa8d6896725_certpw',      'Sicoob produção · senha do cert')
ON CONFLICT DO NOTHING;

-- APS entra pelo Cofre. Aparecem "PENDENTE" na tela ate o admin preencher via UI.
INSERT INTO public.erp_credencial (provider, chave, escopo, company_id, nome_secret_vault, label) VALUES
  ('aps', 'client_id',     'global', NULL, 'APS_CLIENT_ID',     'Autodesk APS · Client ID'),
  ('aps', 'client_secret', 'global', NULL, 'APS_CLIENT_SECRET', 'Autodesk APS · Client Secret')
ON CONFLICT DO NOTHING;
