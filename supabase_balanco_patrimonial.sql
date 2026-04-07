-- Balanço Patrimonial
CREATE TABLE IF NOT EXISTS balanco_patrimonial (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, company_id UUID NOT NULL, lado TEXT NOT NULL, grupo TEXT NOT NULL, subgrupo TEXT DEFAULT '', nome TEXT NOT NULL, valor NUMERIC DEFAULT 0, obs TEXT DEFAULT '', periodo TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- Financiamentos detalhados
CREATE TABLE IF NOT EXISTS financiamentos (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, company_id UUID NOT NULL, banco TEXT NOT NULL, tipo TEXT DEFAULT 'Empréstimo', valor_original NUMERIC DEFAULT 0, saldo_devedor NUMERIC DEFAULT 0, taxa_mensal NUMERIC DEFAULT 0, parcelas INT DEFAULT 0, parcelas_restantes INT DEFAULT 0, vencimento TEXT DEFAULT '', garantia TEXT DEFAULT '', status TEXT DEFAULT 'ativo', created_at TIMESTAMPTZ DEFAULT NOW());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bp_company ON balanco_patrimonial(company_id);
CREATE INDEX IF NOT EXISTS idx_fin_company ON financiamentos(company_id);

-- RLS
ALTER TABLE balanco_patrimonial ENABLE ROW LEVEL SECURITY;
ALTER TABLE financiamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_bp" ON balanco_patrimonial FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_fin" ON financiamentos FOR ALL USING (true) WITH CHECK (true);
