-- Fichas Técnicas (tipologias de produto/serviço)
CREATE TABLE IF NOT EXISTS fichas_tecnicas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  nome TEXT NOT NULL,
  categoria TEXT DEFAULT 'parede',
  descricao TEXT DEFAULT '',
  unidade TEXT DEFAULT 'm²',
  mao_obra_direta NUMERIC DEFAULT 0,
  custos_indiretos_pct NUMERIC DEFAULT 0,
  impostos_pct NUMERIC DEFAULT 0,
  markup_pct NUMERIC DEFAULT 30,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Itens da Ficha Técnica (materiais para produzir 1 unidade)
CREATE TABLE IF NOT EXISTS ficha_itens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ficha_id UUID NOT NULL REFERENCES fichas_tecnicas(id) ON DELETE CASCADE,
  ordem INT DEFAULT 0,
  nome TEXT NOT NULL,
  unidade TEXT DEFAULT 'un',
  quantidade NUMERIC DEFAULT 0,
  preco_unitario NUMERIC DEFAULT 0,
  fornecedor TEXT DEFAULT '',
  obs TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ft_comp ON fichas_tecnicas(company_id);
CREATE INDEX IF NOT EXISTS idx_fi_ficha ON ficha_itens(ficha_id);

ALTER TABLE fichas_tecnicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ficha_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_ft" ON fichas_tecnicas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_fi" ON ficha_itens FOR ALL USING (true) WITH CHECK (true);
