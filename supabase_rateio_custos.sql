-- Linhas de negócio com rateio de custos
CREATE TABLE IF NOT EXISTS business_line_config (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, company_id UUID NOT NULL, group_id UUID, nome TEXT NOT NULL, descricao TEXT DEFAULT '', cnpj_origem TEXT DEFAULT '', responsavel TEXT DEFAULT '', headcount INT DEFAULT 0, area_m2 NUMERIC DEFAULT 0, rateio_pct NUMERIC DEFAULT 0, rateio_modo TEXT DEFAULT 'receita', cor TEXT DEFAULT '#C6973F', ativo BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- Custos diretos por linha de negócio
CREATE TABLE IF NOT EXISTS business_line_custos (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, business_line_id UUID REFERENCES business_line_config(id) ON DELETE CASCADE, nome TEXT NOT NULL, valor NUMERIC DEFAULT 0, tipo TEXT DEFAULT 'direto', periodo TEXT DEFAULT '', obs TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());

-- Receitas por linha de negócio
CREATE TABLE IF NOT EXISTS business_line_receitas (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, business_line_id UUID REFERENCES business_line_config(id) ON DELETE CASCADE, nome TEXT NOT NULL, valor NUMERIC DEFAULT 0, periodo TEXT DEFAULT '', obs TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());

-- Custos compartilhados da sede
CREATE TABLE IF NOT EXISTS custos_sede (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, group_id UUID, company_id UUID, nome TEXT NOT NULL, valor NUMERIC DEFAULT 0, criterio_rateio TEXT DEFAULT 'receita', periodo TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blc_company ON business_line_config(company_id);
CREATE INDEX IF NOT EXISTS idx_blcustos_bl ON business_line_custos(business_line_id);
CREATE INDEX IF NOT EXISTS idx_blreceitas_bl ON business_line_receitas(business_line_id);

-- RLS
ALTER TABLE business_line_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_line_custos ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_line_receitas ENABLE ROW LEVEL SECURITY;
ALTER TABLE custos_sede ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_blc" ON business_line_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_blcustos" ON business_line_custos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_blreceitas" ON business_line_receitas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_csede" ON custos_sede FOR ALL USING (true) WITH CHECK (true);
