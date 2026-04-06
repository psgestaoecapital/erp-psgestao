-- Tabela para armazenar dados importados do Omie
CREATE TABLE IF NOT EXISTS omie_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL,
  import_data JSONB NOT NULL,
  record_count INTEGER DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_omie_imports_company ON omie_imports(company_id, import_type);
ALTER TABLE omie_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read omie_imports" ON omie_imports FOR SELECT USING (true);
CREATE POLICY "Anyone can insert omie_imports" ON omie_imports FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update omie_imports" ON omie_imports FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete omie_imports" ON omie_imports FOR DELETE USING (true);

-- Colunas para credenciais Omie na tabela companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS omie_app_key TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS omie_app_secret TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_omie_sync TIMESTAMPTZ;
