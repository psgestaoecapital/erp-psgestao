-- Tabela de sugestões dos usuários
CREATE TABLE IF NOT EXISTS sugestoes (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID, user_email TEXT DEFAULT '', user_name TEXT DEFAULT '', tipo TEXT DEFAULT 'melhoria', titulo TEXT NOT NULL, descricao TEXT NOT NULL, prioridade TEXT DEFAULT 'media', status TEXT DEFAULT 'pendente', resposta TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

ALTER TABLE sugestoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_sugestoes" ON sugestoes FOR ALL USING (true) WITH CHECK (true);
