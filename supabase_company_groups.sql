-- ============================================================
-- SUPABASE MIGRATION: Tabela de Grupos de Empresas
-- ERP PS Gestão v7.1 — Módulo de Agrupamento
-- ============================================================

-- Tabela de grupos
CREATE TABLE IF NOT EXISTS company_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cor TEXT DEFAULT '#C6973F',
  descricao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vínculo empresa ↔ grupo
-- Uma empresa pode pertencer a um grupo
ALTER TABLE companies ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES company_groups(id) ON DELETE SET NULL;

-- Index para performance
CREATE INDEX IF NOT EXISTS idx_companies_group_id ON companies(group_id);
CREATE INDEX IF NOT EXISTS idx_company_groups_org_id ON company_groups(org_id);

-- RLS: usuários só veem grupos da sua organização
ALTER TABLE company_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org groups" ON company_groups
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert own org groups" ON company_groups
  FOR INSERT WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own org groups" ON company_groups
  FOR UPDATE USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete own org groups" ON company_groups
  FOR DELETE USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_company_groups_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_company_groups_updated
  BEFORE UPDATE ON company_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_company_groups_timestamp();
