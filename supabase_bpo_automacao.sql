-- BPO Rotinas automáticas por empresa
CREATE TABLE IF NOT EXISTS bpo_rotinas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'auto_classificacao',
  ativo BOOLEAN DEFAULT true,
  frequencia TEXT DEFAULT 'diaria',
  ultima_execucao TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Classificações sugeridas pela IA (fila de aprovação)
CREATE TABLE IF NOT EXISTS bpo_classificacoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  tipo_conta TEXT NOT NULL DEFAULT 'pagar',
  documento TEXT DEFAULT '',
  data_lancamento TEXT DEFAULT '',
  valor NUMERIC DEFAULT 0,
  nome_cliente_fornecedor TEXT DEFAULT '',
  categoria_atual TEXT DEFAULT '',
  categoria_sugerida TEXT DEFAULT '',
  confianca NUMERIC DEFAULT 0,
  justificativa TEXT DEFAULT '',
  status TEXT DEFAULT 'pendente',
  operador_id UUID,
  operador_acao TEXT DEFAULT '',
  categoria_final TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log de sincronizações
CREATE TABLE IF NOT EXISTS bpo_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  tipo TEXT DEFAULT 'omie_sync',
  status TEXT DEFAULT 'sucesso',
  registros_processados INT DEFAULT 0,
  classificacoes_geradas INT DEFAULT 0,
  erros TEXT DEFAULT '',
  duracao_ms INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bpo_class_comp ON bpo_classificacoes(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bpo_rot_comp ON bpo_rotinas(company_id);

ALTER TABLE bpo_rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bpo_classificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bpo_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_bpo_rot" ON bpo_rotinas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_bpo_class" ON bpo_classificacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_bpo_sync" ON bpo_sync_log FOR ALL USING (true) WITH CHECK (true);
