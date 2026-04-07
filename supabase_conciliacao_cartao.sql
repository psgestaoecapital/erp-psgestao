-- Conciliação de Cartão de Crédito
CREATE TABLE IF NOT EXISTS conciliacao_cartao (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  nome_fatura TEXT DEFAULT '',
  operadora TEXT DEFAULT '',
  periodo TEXT DEFAULT '',
  total_fatura NUMERIC DEFAULT 0,
  total_omie NUMERIC DEFAULT 0,
  divergencia NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'em_andamento',
  itens_conciliados INT DEFAULT 0,
  itens_divergentes INT DEFAULT 0,
  itens_somente_fatura INT DEFAULT 0,
  itens_somente_omie INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conciliacao_itens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conciliacao_id UUID NOT NULL REFERENCES conciliacao_cartao(id) ON DELETE CASCADE,
  fonte TEXT NOT NULL DEFAULT 'fatura',
  data_transacao TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  valor NUMERIC DEFAULT 0,
  categoria TEXT DEFAULT '',
  match_id TEXT DEFAULT '',
  match_score NUMERIC DEFAULT 0,
  match_descricao TEXT DEFAULT '',
  match_valor NUMERIC DEFAULT 0,
  match_data TEXT DEFAULT '',
  status TEXT DEFAULT 'pendente',
  operador_acao TEXT DEFAULT '',
  obs TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conciliacao_cartao ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacao_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_cc" ON conciliacao_cartao FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_ci2" ON conciliacao_itens FOR ALL USING (true) WITH CHECK (true);
