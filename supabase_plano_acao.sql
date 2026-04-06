-- Tabela Plano de Ação
CREATE TABLE IF NOT EXISTS plano_acao (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  acao TEXT NOT NULL,
  responsavel TEXT,
  prazo DATE,
  status TEXT DEFAULT 'pendente',
  prioridade TEXT DEFAULT 'media',
  impacto_esperado TEXT,
  categoria TEXT DEFAULT 'operacional',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plano_acao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can manage plano_acao" ON plano_acao FOR ALL USING (true) WITH CHECK (true);

-- Tabela Alertas de Dados
CREATE TABLE IF NOT EXISTS data_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  severidade TEXT DEFAULT 'atencao',
  mensagem TEXT NOT NULL,
  detalhe TEXT,
  sugestao TEXT,
  resolvido BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE data_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can manage data_alerts" ON data_alerts FOR ALL USING (true) WITH CHECK (true);
