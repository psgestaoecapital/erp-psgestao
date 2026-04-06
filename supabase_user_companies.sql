-- TABELA: user_companies (vinculação usuário ↔ empresas)
-- Permite que um usuário acesse múltiplas empresas
-- E que uma empresa seja acessada por múltiplos usuários

CREATE TABLE IF NOT EXISTS user_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'visualizador',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, company_id)
);

-- Index para performance
CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

-- RLS: usuário vê apenas suas vinculações
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own company links"
  ON user_companies FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all company links"
  ON user_companies FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Migrar usuários existentes: vincular admin a TODAS as empresas
-- (rodar apenas uma vez após criar a tabela)
INSERT INTO user_companies (user_id, company_id, role)
SELECT u.id, c.id, u.role
FROM users u
CROSS JOIN companies c
WHERE u.role = 'admin'
ON CONFLICT (user_id, company_id) DO NOTHING;
