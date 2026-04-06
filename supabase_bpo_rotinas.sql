CREATE TABLE IF NOT EXISTS bpo_rotinas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  frequencia TEXT NOT NULL DEFAULT 'mensal',
  executor TEXT NOT NULL DEFAULT 'ia',
  ativo BOOLEAN DEFAULT true,
  dia_execucao INTEGER,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS bpo_tarefas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rotina_id UUID REFERENCES bpo_rotinas(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  executor TEXT NOT NULL DEFAULT 'ia',
  data_prevista DATE,
  data_execucao TIMESTAMPTZ,
  resultado JSONB DEFAULT '{}',
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  executado_por UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_bpo_rotinas_company ON bpo_rotinas(company_id);
CREATE INDEX IF NOT EXISTS idx_bpo_tarefas_company ON bpo_tarefas(company_id);
CREATE INDEX IF NOT EXISTS idx_bpo_tarefas_status ON bpo_tarefas(status);

ALTER TABLE bpo_rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bpo_tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users manage rotinas" ON bpo_rotinas FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users manage tarefas" ON bpo_tarefas FOR ALL USING (auth.uid() IS NOT NULL);
