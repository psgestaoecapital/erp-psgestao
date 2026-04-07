-- Orçamento por categoria e mês
CREATE TABLE IF NOT EXISTS orcamento (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, company_id UUID NOT NULL, periodo TEXT NOT NULL, categoria TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'despesa', valor_orcado NUMERIC DEFAULT 0, obs TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(company_id, periodo, categoria));

CREATE INDEX IF NOT EXISTS idx_orc_comp_per ON orcamento(company_id, periodo);

ALTER TABLE orcamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_orc" ON orcamento FOR ALL USING (true) WITH CHECK (true);
