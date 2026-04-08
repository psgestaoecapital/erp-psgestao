CREATE TABLE IF NOT EXISTS dev_chat (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pergunta TEXT DEFAULT '',
  resposta TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dev_chat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all" ON dev_chat FOR ALL USING (true) WITH CHECK (true);
