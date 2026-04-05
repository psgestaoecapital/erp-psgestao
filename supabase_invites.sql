-- ============================================================
-- SISTEMA DE CONVITES — PS Gestão e Capital
-- ============================================================

-- Tabela de convites
CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT DEFAULT 'geral' CHECK (role IN ('adm','conselheiro','financeiro','rh','geral')),
  invite_code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  is_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invites_code ON invites(invite_code);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Permitir leitura pública do convite (para validar o código)
CREATE POLICY "Anyone can read invite by code" ON invites
  FOR SELECT USING (true);

-- Apenas usuários autenticados da org podem criar convites
CREATE POLICY "Org users can create invites" ON invites
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Permitir atualização quando convite é usado
CREATE POLICY "Anyone can use invite" ON invites
  FOR UPDATE USING (true);
