-- ============================================================
-- MIGRAÇÃO: Campos adicionais para formulários de entrada
-- ============================================================

-- Campos extras na tabela companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS num_colaboradores INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS faturamento_anual NUMERIC;

-- Campos extras na tabela business_lines
ALTER TABLE business_lines ADD COLUMN IF NOT EXISTS responsible TEXT;

-- Campos extras na tabela m2_dre_divisional (resultado por negócio)
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS faturamento_bruto NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS devolucoes NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS custo_produtos NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS mao_obra_direta NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS frete NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS comissoes NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS terceiros NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS marketing_direto NUMERIC DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS num_clientes INTEGER DEFAULT 0;
ALTER TABLE m2_dre_divisional ADD COLUMN IF NOT EXISTS ticket_medio NUMERIC DEFAULT 0;

-- Campos extras na tabela m3_dre_sede (custos da estrutura)
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS prolabore NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS folha_adm NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS encargos NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS aluguel NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS energia NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS internet NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS contabilidade NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS juridico NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS combustivel NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS manutencao_veic NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS marketing_inst NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS taxas_cartao NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS seguros NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS depreciacao NUMERIC DEFAULT 0;
ALTER TABLE m3_dre_sede ADD COLUMN IF NOT EXISTS outros NUMERIC DEFAULT 0;

-- RLS policies para as tabelas de dados
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read companies') THEN
    CREATE POLICY "Anyone can read companies" ON companies FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can update companies') THEN
    CREATE POLICY "Anyone can update companies" ON companies FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read business_lines') THEN
    CREATE POLICY "Anyone can read business_lines" ON business_lines FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert business_lines') THEN
    CREATE POLICY "Anyone can insert business_lines" ON business_lines FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can update business_lines') THEN
    CREATE POLICY "Anyone can update business_lines" ON business_lines FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read m2') THEN
    CREATE POLICY "Anyone can read m2" ON m2_dre_divisional FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert m2') THEN
    CREATE POLICY "Anyone can insert m2" ON m2_dre_divisional FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can update m2') THEN
    CREATE POLICY "Anyone can update m2" ON m2_dre_divisional FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read m3') THEN
    CREATE POLICY "Anyone can read m3" ON m3_dre_sede FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert m3') THEN
    CREATE POLICY "Anyone can insert m3" ON m3_dre_sede FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can update m3') THEN
    CREATE POLICY "Anyone can update m3" ON m3_dre_sede FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read ai_reports') THEN
    CREATE POLICY "Anyone can read ai_reports" ON ai_reports FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can insert ai_reports') THEN
    CREATE POLICY "Anyone can insert ai_reports" ON ai_reports FOR INSERT WITH CHECK (true);
  END IF;
END $$;
