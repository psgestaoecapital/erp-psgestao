-- ============================================================
-- MULTI-CNPJ + MULTI-PAÍS — PS Gestão e Capital
-- ============================================================

-- Campos adicionais na tabela companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'Brasil';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS moeda TEXT DEFAULT 'BRL';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS regime_tributario TEXT DEFAULT 'simples';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tipo_empresa TEXT DEFAULT 'matriz';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS id_fiscal_exterior TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Tabela de taxas de câmbio
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL DEFAULT 'BRL',
  rate NUMERIC NOT NULL,
  rate_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, from_currency, to_currency, rate_date)
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read exchange_rates" ON exchange_rates FOR SELECT USING (true);
CREATE POLICY "Anyone can insert exchange_rates" ON exchange_rates FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update exchange_rates" ON exchange_rates FOR UPDATE USING (true);
