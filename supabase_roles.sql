-- Tabela de definição de papéis (referência)
CREATE TABLE IF NOT EXISTS role_definitions (
  role TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  tabs_permitidas TEXT[] DEFAULT '{}',
  pode_editar BOOLEAN DEFAULT false,
  pode_convidar BOOLEAN DEFAULT false,
  pode_ver_custos BOOLEAN DEFAULT false,
  pode_usar_ps BOOLEAN DEFAULT false
);

INSERT INTO role_definitions (role, nome, descricao, tabs_permitidas, pode_editar, pode_convidar, pode_ver_custos, pode_usar_ps) VALUES
('admin', 'Administrador', 'Acesso total ao sistema. Gestão de empresas, usuários e configurações.', 
 ARRAY['geral','negocios','resultado','financeiro','precos','relatorio'], true, true, true, true),
('socio', 'Sócio / CEO', 'Visão completa do negócio. Dashboard, relatórios, plano de ação, Fale com PS.', 
 ARRAY['geral','negocios','resultado','financeiro','precos','relatorio'], true, false, true, true),
('financeiro', 'Financeiro', 'Acesso a dados financeiros: DRE, custos, contas a pagar/receber, fluxo de caixa.', 
 ARRAY['geral','resultado','financeiro','precos'], true, false, true, false),
('comercial', 'Comercial', 'Acesso a receitas, clientes, vendas. Sem visibilidade de custos detalhados.', 
 ARRAY['geral','negocios','precos'], false, false, false, false),
('operacional', 'Operacional', 'Plano de ação, alertas, dados operacionais básicos.', 
 ARRAY['geral','negocios'], false, false, false, false),
('consultor', 'Consultor Externo', 'Acesso completo em modo leitura. Para consultores da PS Gestão acessarem clientes.', 
 ARRAY['geral','negocios','resultado','financeiro','precos','relatorio'], false, false, true, true),
('visualizador', 'Visualizador', 'Apenas visualização do painel geral. Sem acesso a dados detalhados.', 
 ARRAY['geral'], false, false, false, false)
ON CONFLICT (role) DO NOTHING;

-- Adicionar campo role na tabela users se não existir
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'visualizador';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
