-- ============================================================
-- SUPABASE MIGRATION: Plataforma SaaS - Planos, Assinaturas, BPO, Viabilidade
-- ERP PS Gestão v7.2
-- ============================================================

-- 1. Tabela de Planos
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, nome TEXT NOT NULL, preco_mensal NUMERIC DEFAULT 0, max_users INT DEFAULT 2, max_companies INT DEFAULT 1, features JSONB DEFAULT '[]', ativo BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

-- Inserir planos
INSERT INTO plans (id, nome, preco_mensal, max_users, max_companies, features) VALUES
('essencial', 'ERP Essencial', 297, 2, 1, '["dashboard","dre","custos","analise_ia","integracao_omie"]'),
('profissional', 'ERP Profissional', 597, 10, 5, '["dashboard","dre","custos","analise_ia","integracao_omie","grupos","viabilidade","conciliacao","relatorio_pdf","niveis_acesso"]'),
('bpo', 'BPO Inteligente', 997, 50, 999, '["dashboard","dre","custos","analise_ia","integracao_omie","grupos","viabilidade","conciliacao","relatorio_pdf","niveis_acesso","bpo_dashboard","bpo_rotinas","bpo_conectores","api_contador","whitelabel"]'),
('enterprise', 'Enterprise', 0, 999, 999, '["all"]')
ON CONFLICT (id) DO NOTHING;

-- 2. Tabela de Assinaturas
CREATE TABLE IF NOT EXISTS subscriptions (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, org_id UUID, plan_id TEXT REFERENCES plans(id), status TEXT DEFAULT 'trial', trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'), stripe_customer_id TEXT, stripe_subscription_id TEXT, current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ, cancel_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- 3. Fontes de cadastro (para tracking de canais)
CREATE TABLE IF NOT EXISTS signup_sources (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID, canal TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, coupon TEXT, created_at TIMESTAMPTZ DEFAULT NOW());

-- 4. Operador ↔ Empresa (BPO: operador só vê empresas atribuídas)
CREATE TABLE IF NOT EXISTS operator_clients (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID NOT NULL, company_id UUID NOT NULL, assigned_by UUID, assigned_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, company_id));

-- 5. Análises de Viabilidade
CREATE TABLE IF NOT EXISTS viability_analyses (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, org_id UUID, company_id UUID, user_id UUID, file_name TEXT, file_type TEXT, file_size INT, input_data JSONB, result JSONB, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW());

-- 6. Adicionar plan_id na org (se não existir)
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'essencial'; EXCEPTION WHEN others THEN NULL; END $$;

-- 7. RLS para novas tabelas
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE viability_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_subs" ON subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sources" ON signup_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_opcli" ON operator_clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_viab" ON viability_analyses FOR ALL USING (true) WITH CHECK (true);
