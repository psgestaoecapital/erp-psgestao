-- ══════════════════════════════════════════════════════════
-- SEGURANÇA: Row Level Security (RLS) — PS Gestão e Capital
-- Proteção no nível do BANCO DE DADOS
-- Mesmo com bug no frontend, dados NUNCA vazam
-- ══════════════════════════════════════════════════════════

-- 1. FUNÇÃO AUXILIAR: verifica se o usuário é admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'adm'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 2. FUNÇÃO AUXILIAR: retorna IDs das empresas que o usuário pode acessar
CREATE OR REPLACE FUNCTION user_company_ids()
RETURNS SETOF UUID AS $$
  SELECT company_id FROM user_companies WHERE user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════════
-- 3. COMPANIES — usuário só vê empresas vinculadas
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "companies_select" ON companies;
DROP POLICY IF EXISTS "companies_all" ON companies;
DROP POLICY IF EXISTS "allow_all" ON companies;

CREATE POLICY "companies_select" ON companies FOR SELECT USING (
  is_admin() OR id IN (SELECT user_company_ids())
);
CREATE POLICY "companies_insert" ON companies FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "companies_update" ON companies FOR UPDATE USING (is_admin());
CREATE POLICY "companies_delete" ON companies FOR DELETE USING (is_admin());

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 4. OMIE_IMPORTS — dados financeiros protegidos
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON omie_imports;
DROP POLICY IF EXISTS "omie_imports_select" ON omie_imports;

CREATE POLICY "omie_imports_select" ON omie_imports FOR SELECT USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);
CREATE POLICY "omie_imports_insert" ON omie_imports FOR INSERT WITH CHECK (
  is_admin() OR company_id IN (SELECT user_company_ids())
);
CREATE POLICY "omie_imports_update" ON omie_imports FOR UPDATE USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE omie_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE omie_imports FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 5. FICHAS TÉCNICAS
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all_ft" ON fichas_tecnicas;
DROP POLICY IF EXISTS "ft_select" ON fichas_tecnicas;

CREATE POLICY "ft_select" ON fichas_tecnicas FOR SELECT USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);
CREATE POLICY "ft_modify" ON fichas_tecnicas FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE fichas_tecnicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichas_tecnicas FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 6. FICHA ITENS (via ficha_id → fichas_tecnicas)
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all_fi" ON ficha_itens;

CREATE POLICY "fi_all" ON ficha_itens FOR ALL USING (
  is_admin() OR ficha_id IN (
    SELECT id FROM fichas_tecnicas WHERE company_id IN (SELECT user_company_ids())
  )
);

ALTER TABLE ficha_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ficha_itens FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 7. ORÇAMENTO
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all_orc" ON orcamento;

CREATE POLICY "orc_all" ON orcamento FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE orcamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 8. BALANÇO PATRIMONIAL
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON balanco_patrimonial;

CREATE POLICY "bp_all" ON balanco_patrimonial FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE balanco_patrimonial ENABLE ROW LEVEL SECURITY;
ALTER TABLE balanco_patrimonial FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 9. FINANCIAMENTOS
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON financiamentos;

CREATE POLICY "fin_all" ON financiamentos FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE financiamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE financiamentos FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 10. BUSINESS LINES
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON business_lines;
DROP POLICY IF EXISTS "allow_all" ON business_line_config;

CREATE POLICY "bl_all" ON business_lines FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);
CREATE POLICY "blc_all" ON business_line_config FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);

ALTER TABLE business_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE business_line_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_line_config FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 11. CONCILIAÇÃO CARTÃO
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all_cc" ON conciliacao_cartao;
DROP POLICY IF EXISTS "allow_all_ci2" ON conciliacao_itens;

CREATE POLICY "cc_all" ON conciliacao_cartao FOR ALL USING (
  is_admin() OR company_id IN (SELECT user_company_ids())
);
CREATE POLICY "ci_all" ON conciliacao_itens FOR ALL USING (
  is_admin() OR conciliacao_id IN (
    SELECT id FROM conciliacao_cartao WHERE company_id IN (SELECT user_company_ids())
  )
);

ALTER TABLE conciliacao_cartao ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacao_cartao FORCE ROW LEVEL SECURITY;
ALTER TABLE conciliacao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacao_itens FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 12. USER_COMPANIES — usuário só vê seus próprios vínculos
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON user_companies;

CREATE POLICY "uc_select" ON user_companies FOR SELECT USING (
  is_admin() OR user_id = auth.uid()
);
CREATE POLICY "uc_modify" ON user_companies FOR ALL USING (is_admin());

ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_companies FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 13. USERS — cada um vê só a si, admin vê todos
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON users;

CREATE POLICY "users_select" ON users FOR SELECT USING (
  is_admin() OR id = auth.uid()
);
CREATE POLICY "users_modify" ON users FOR ALL USING (
  is_admin() OR id = auth.uid()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 14. SUGESTÕES — todos podem criar, admin gerencia
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON sugestoes;

CREATE POLICY "sug_select" ON sugestoes FOR SELECT USING (
  is_admin() OR user_id = auth.uid()
);
CREATE POLICY "sug_insert" ON sugestoes FOR INSERT WITH CHECK (true);
CREATE POLICY "sug_update" ON sugestoes FOR UPDATE USING (
  is_admin() OR user_id = auth.uid()
);

ALTER TABLE sugestoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sugestoes FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 15. INVITES — só admin
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON invites;

CREATE POLICY "inv_select" ON invites FOR SELECT USING (is_admin());
CREATE POLICY "inv_insert" ON invites FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "inv_modify" ON invites FOR ALL USING (is_admin());

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- 16. COMPANY GROUPS + ORGANIZATIONS — admin vê todos
-- ══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow_all" ON company_groups;
DROP POLICY IF EXISTS "allow_all" ON organizations;

CREATE POLICY "cg_select" ON company_groups FOR SELECT USING (true);
CREATE POLICY "cg_modify" ON company_groups FOR ALL USING (is_admin());

CREATE POLICY "org_all" ON organizations FOR ALL USING (is_admin());

ALTER TABLE company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════
-- VERIFICAÇÃO: conferir que tudo está ativo
-- ══════════════════════════════════════════════════════════
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
