-- ============================================================
-- PS GESTÃO E CAPITAL — ERP INTELIGENTE COM IA
-- Schema PostgreSQL para Supabase
-- Versão 1.0 MVP | 19 Módulos | Multi-tenant | LGPD
-- ============================================================

-- ========== EXTENSÕES ==========
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========== ORGANIZAÇÕES (MULTI-TENANT) ==========
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#0C2340',
  plan TEXT DEFAULT 'essencial' CHECK (plan IN ('essencial','profissional','enterprise')),
  max_companies INTEGER DEFAULT 1,
  max_users INTEGER DEFAULT 3,
  is_whitelabel BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== USUÁRIOS E ACESSO (RBAC) ==========
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'geral' CHECK (role IN ('adm','conselheiro','financeiro','rh','geral')),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== EMPRESAS CLIENTES ==========
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- M0 Cadastro
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj TEXT UNIQUE,
  inscricao_estadual TEXT,
  inscricao_municipal TEXT,
  cidade_estado TEXT,
  endereco TEXT,
  cnae TEXT,
  regime_tributario TEXT CHECK (regime_tributario IN ('SIMPLES','PRESUMIDO','REAL')),
  data_constituicao DATE,
  capital_social DECIMAL(15,2),
  num_socios INTEGER DEFAULT 1,
  socios JSONB DEFAULT '[]',
  modelo_negocio TEXT,
  tipo_operacao TEXT,
  num_pdv INTEGER DEFAULT 1,
  area_comercial DECIMAL(10,2),
  num_lns_ativas INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  health TEXT DEFAULT 'good' CHECK (health IN ('good','warning','critical')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== LINHAS DE NEGÓCIO ==========
CREATE TABLE business_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ln_number INTEGER NOT NULL CHECK (ln_number BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('comercio','servico','misto')),
  headcount INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  bcg_class TEXT CHECK (bcg_class IN ('estrela','vaca_leiteira','interrogacao','abacaxi')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, ln_number)
);

-- ========== DADOS MENSAIS — M2 DRE DIVISIONAL ==========
CREATE TABLE m2_dre_divisional (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ln_id UUID NOT NULL REFERENCES business_lines(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2035),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Receita
  volume DECIMAL(15,2) DEFAULT 0,
  receita_bruta DECIMAL(15,2) DEFAULT 0,
  deducoes DECIMAL(15,2) DEFAULT 0,
  impostos_diretos DECIMAL(15,2) DEFAULT 0,
  -- Custos diretos
  cmv DECIMAL(15,2) DEFAULT 0,
  mao_obra_direta DECIMAL(15,2) DEFAULT 0,
  terceirizacao DECIMAL(15,2) DEFAULT 0,
  logistica DECIMAL(15,2) DEFAULT 0,
  custo_fixo_direto DECIMAL(15,2) DEFAULT 0,
  marketing_direto DECIMAL(15,2) DEFAULT 0,
  comissoes DECIMAL(15,2) DEFAULT 0,
  capex DECIMAL(15,2) DEFAULT 0,
  -- Metas
  meta_receita DECIMAL(15,2) DEFAULT 0,
  meta_margem_pct DECIMAL(5,4) DEFAULT 0,
  -- Comercial
  clientes_ativos INTEGER DEFAULT 0,
  novos_clientes INTEGER DEFAULT 0,
  clientes_perdidos INTEGER DEFAULT 0,
  pmr_dias INTEGER DEFAULT 0,
  inadimplencia_pct DECIMAL(5,4) DEFAULT 0,
  ticket_medio DECIMAL(15,2) DEFAULT 0,
  cac DECIMAL(15,2) DEFAULT 0,
  markup_pct DECIMAL(5,4) DEFAULT 0,
  atendimentos INTEGER DEFAULT 0,
  tempo_entrega_dias INTEGER DEFAULT 0,
  retrabalho_pct DECIMAL(5,4) DEFAULT 0,
  -- Calculados (triggers ou views)
  receita_liquida DECIMAL(15,2) GENERATED ALWAYS AS (receita_bruta - deducoes - impostos_diretos) STORED,
  margem_contribuicao DECIMAL(15,2) GENERATED ALWAYS AS (
    receita_bruta - deducoes - impostos_diretos - cmv - mao_obra_direta - terceirizacao - logistica - custo_fixo_direto - marketing_direto - comissoes
  ) STORED,
  -- Metadata
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual','xlsx','api_contaazul','api_omie','api_bling')),
  api_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, ln_id, year, month)
);

-- ========== M3 DRE SEDE ==========
CREATE TABLE m3_dre_sede (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  -- Sócios
  prolabore_total DECIMAL(15,2) DEFAULT 0,
  sangrias DECIMAL(15,2) DEFAULT 0,
  -- Folha retaguarda
  folha_retaguarda DECIMAL(15,2) DEFAULT 0,
  encargos DECIMAL(15,2) DEFAULT 0,
  beneficios_vr DECIMAL(15,2) DEFAULT 0,
  beneficios_saude DECIMAL(15,2) DEFAULT 0,
  beneficios_vt DECIMAL(15,2) DEFAULT 0,
  -- Ocupação
  aluguel DECIMAL(15,2) DEFAULT 0,
  energia DECIMAL(15,2) DEFAULT 0,
  agua DECIMAL(15,2) DEFAULT 0,
  internet DECIMAL(15,2) DEFAULT 0,
  telefonia DECIMAL(15,2) DEFAULT 0,
  -- Administrativo
  contabilidade DECIMAL(15,2) DEFAULT 0,
  assessoria DECIMAL(15,2) DEFAULT 0,
  juridico DECIMAL(15,2) DEFAULT 0,
  software DECIMAL(15,2) DEFAULT 0,
  -- Marketing
  marketing_inst DECIMAL(15,2) DEFAULT 0,
  viagens DECIMAL(15,2) DEFAULT 0,
  -- Frota
  combustiveis DECIMAL(15,2) DEFAULT 0,
  manut_veiculos DECIMAL(15,2) DEFAULT 0,
  seguro_veiculos DECIMAL(15,2) DEFAULT 0,
  -- Comércio
  taxas_cartao DECIMAL(15,2) DEFAULT 0,
  perdas DECIMAL(15,2) DEFAULT 0,
  -- Seguros
  seguros DECIMAL(15,2) DEFAULT 0,
  outros_custos DECIMAL(15,2) DEFAULT 0,
  -- D&A
  depreciacao DECIMAL(15,2) DEFAULT 0,
  amortizacao DECIMAL(15,2) DEFAULT 0,
  -- Financeiro
  receitas_financeiras DECIMAL(15,2) DEFAULT 0,
  despesas_financeiras DECIMAL(15,2) DEFAULT 0,
  parcelas_emprestimos DECIMAL(15,2) DEFAULT 0,
  parcelas_consorcio DECIMAL(15,2) DEFAULT 0,
  -- Impostos
  provisao_ir DECIMAL(15,2) DEFAULT 0,
  distribuicao_lucros DECIMAL(15,2) DEFAULT 0,
  -- Source
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ========== M1 BALANÇO ==========
CREATE TABLE m1_balanco (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  -- Ativo Circulante
  caixa_fisico DECIMAL(15,2) DEFAULT 0,
  banco_1 DECIMAL(15,2) DEFAULT 0,
  banco_2 DECIMAL(15,2) DEFAULT 0,
  banco_3 DECIMAL(15,2) DEFAULT 0,
  aplicacoes_cp DECIMAL(15,2) DEFAULT 0,
  recebiveis_030 DECIMAL(15,2) DEFAULT 0,
  recebiveis_3160 DECIMAL(15,2) DEFAULT 0,
  recebiveis_6190 DECIMAL(15,2) DEFAULT 0,
  recebiveis_90p DECIMAL(15,2) DEFAULT 0,
  cartao_credito DECIMAL(15,2) DEFAULT 0,
  cartao_debito DECIMAL(15,2) DEFAULT 0,
  estoques JSONB DEFAULT '{}', -- {ln1: 0, ln2: 0, ...}
  -- Ativo Não Circulante
  imobilizado_bruto DECIMAL(15,2) DEFAULT 0,
  depreciacao_acum DECIMAL(15,2) DEFAULT 0,
  intangiveis DECIMAL(15,2) DEFAULT 0,
  -- Passivo Circulante
  fornecedores DECIMAL(15,2) DEFAULT 0,
  obrig_fiscais DECIMAL(15,2) DEFAULT 0,
  obrig_trabalhistas DECIMAL(15,2) DEFAULT 0,
  divida_cp DECIMAL(15,2) DEFAULT 0,
  -- Passivo Não Circulante
  divida_lp DECIMAL(15,2) DEFAULT 0,
  provisoes DECIMAL(15,2) DEFAULT 0,
  -- PL
  capital_social DECIMAL(15,2) DEFAULT 0,
  reservas DECIMAL(15,2) DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ========== M16A INSUMOS ==========
CREATE TABLE m16_insumos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  erp_code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT,
  supplier TEXT,
  current_cost DECIMAL(15,4) DEFAULT 0,
  last_cost DECIMAL(15,4) DEFAULT 0,
  last_purchase_date DATE,
  ncm TEXT,
  status TEXT DEFAULT 'ativo',
  source TEXT DEFAULT 'manual',
  api_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, erp_code)
);

-- ========== M16B FICHA TÉCNICA / BOM ==========
CREATE TABLE m16_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ln_id UUID REFERENCES business_lines(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  product_type TEXT CHECK (product_type IN ('comercio','servico')),
  rateio_pct DECIMAL(5,4) DEFAULT 0.10,
  markup_min DECIMAL(5,4) DEFAULT 0.30,
  markup_ideal DECIMAL(5,4) DEFAULT 0.50,
  preco_praticado DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  erp_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE m16_bom (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES m16_products(id) ON DELETE CASCADE,
  insumo_id UUID NOT NULL REFERENCES m16_insumos(id) ON DELETE CASCADE,
  consumption_per_unit DECIMAL(15,4) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(product_id, insumo_id)
);

-- ========== M18 CONTRATOS E RECORRÊNCIA ==========
CREATE TABLE m18_contratos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  contratos_inicio INTEGER DEFAULT 0,
  novos INTEGER DEFAULT 0,
  renovacoes INTEGER DEFAULT 0,
  cancelamentos INTEGER DEFAULT 0,
  suspensos INTEGER DEFAULT 0,
  mrr DECIMAL(15,2) DEFAULT 0,
  ticket_medio DECIMAL(15,2) DEFAULT 0,
  churn_pct DECIMAL(5,4) DEFAULT 0,
  ltv DECIMAL(15,2) DEFAULT 0,
  cac DECIMAL(15,2) DEFAULT 0,
  nps INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ========== M19 ESTOQUE ==========
CREATE TABLE m19_estoque (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  estoque_custo DECIMAL(15,2) DEFAULT 0,
  estoque_venda DECIMAL(15,2) DEFAULT 0,
  giro DECIMAL(8,2) DEFAULT 0,
  cobertura_dias INTEGER DEFAULT 0,
  ruptura_pct DECIMAL(5,4) DEFAULT 0,
  perdas DECIMAL(15,2) DEFAULT 0,
  devolucoes DECIMAL(15,2) DEFAULT 0,
  sku_total INTEGER DEFAULT 0,
  sku_ativos INTEGER DEFAULT 0,
  sku_parados INTEGER DEFAULT 0,
  obsoleto_rs DECIMAL(15,2) DEFAULT 0,
  entregas INTEGER DEFAULT 0,
  prazo_entrega_dias INTEGER DEFAULT 0,
  custo_entrega DECIMAL(15,2) DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ========== RELATÓRIOS GERADOS POR IA ==========
CREATE TABLE ai_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES users(id),
  report_type TEXT DEFAULT 'ceo_edition' CHECK (report_type IN ('ceo_edition','flash','valuation','custom')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  prompt_version TEXT DEFAULT 'V21',
  input_data JSONB NOT NULL, -- Blocos M0-M19 serialized
  output_content TEXT, -- Full report markdown
  output_pdf_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','generating','completed','error')),
  tokens_used INTEGER DEFAULT 0,
  generation_time_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== API INTEGRATIONS LOG ==========
CREATE TABLE api_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('contaazul','omie','bling','nibo','manual','xlsx')),
  api_key_encrypted TEXT,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'disconnected',
  modules_synced TEXT[] DEFAULT '{}',
  error_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== ROW LEVEL SECURITY (LGPD) ==========
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE m2_dre_divisional ENABLE ROW LEVEL SECURITY;
ALTER TABLE m3_dre_sede ENABLE ROW LEVEL SECURITY;
ALTER TABLE m1_balanco ENABLE ROW LEVEL SECURITY;
ALTER TABLE m16_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE m16_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE m18_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE m19_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reports ENABLE ROW LEVEL SECURITY;

-- Policies: user only sees data from their organization
CREATE POLICY "Users see own org companies" ON companies
  FOR ALL USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users see own org data" ON m2_dre_divisional
  FOR ALL USING (company_id IN (SELECT id FROM companies WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users see own org sede" ON m3_dre_sede
  FOR ALL USING (company_id IN (SELECT id FROM companies WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users see own org balanco" ON m1_balanco
  FOR ALL USING (company_id IN (SELECT id FROM companies WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

-- ========== VIEWS CALCULADAS (KPIs automáticos — M17) ==========
CREATE OR REPLACE VIEW v_kpis_monthly AS
SELECT
  c.id AS company_id,
  c.razao_social,
  d.year,
  d.month,
  -- Receita
  SUM(d.receita_bruta) AS receita_total,
  SUM(d.receita_liquida) AS receita_liquida_total,
  SUM(d.margem_contribuicao) AS mc_total,
  -- MC%
  CASE WHEN SUM(d.receita_liquida) > 0
    THEN ROUND(SUM(d.margem_contribuicao) / SUM(d.receita_liquida) * 100, 1)
    ELSE 0 END AS mc_pct,
  -- CMV
  SUM(d.cmv) AS cmv_total,
  CASE WHEN SUM(d.receita_liquida) > 0
    THEN ROUND(SUM(d.cmv) / SUM(d.receita_liquida) * 100, 1)
    ELSE 0 END AS cmv_pct,
  -- Custo Sede
  s.custo_sede_total,
  -- Lucro Operacional
  SUM(d.margem_contribuicao) - COALESCE(s.custo_sede_total, 0) AS lucro_operacional,
  -- HC
  (SELECT SUM(bl.headcount) FROM business_lines bl WHERE bl.company_id = c.id) AS headcount,
  -- Receita/Colab
  CASE WHEN (SELECT SUM(bl.headcount) FROM business_lines bl WHERE bl.company_id = c.id) > 0
    THEN ROUND(SUM(d.receita_bruta) / (SELECT SUM(bl.headcount) FROM business_lines bl WHERE bl.company_id = c.id))
    ELSE 0 END AS receita_por_colab
FROM companies c
JOIN m2_dre_divisional d ON d.company_id = c.id
LEFT JOIN LATERAL (
  SELECT
    SUM(COALESCE(prolabore_total,0) + COALESCE(folha_retaguarda,0) + COALESCE(encargos,0) +
        COALESCE(beneficios_vr,0) + COALESCE(beneficios_saude,0) + COALESCE(beneficios_vt,0) +
        COALESCE(aluguel,0) + COALESCE(energia,0) + COALESCE(agua,0) + COALESCE(internet,0) +
        COALESCE(telefonia,0) + COALESCE(contabilidade,0) + COALESCE(assessoria,0) +
        COALESCE(juridico,0) + COALESCE(software,0) + COALESCE(marketing_inst,0) +
        COALESCE(viagens,0) + COALESCE(combustiveis,0) + COALESCE(manut_veiculos,0) +
        COALESCE(seguro_veiculos,0) + COALESCE(taxas_cartao,0) + COALESCE(perdas,0) +
        COALESCE(seguros,0) + COALESCE(outros_custos,0) + COALESCE(depreciacao,0) +
        COALESCE(amortizacao,0)) AS custo_sede_total
  FROM m3_dre_sede s2
  WHERE s2.company_id = c.id AND s2.year = d.year AND s2.month = d.month
) s ON TRUE
GROUP BY c.id, c.razao_social, d.year, d.month, s.custo_sede_total;

-- ========== VIEW: Rateio por LN ==========
CREATE OR REPLACE VIEW v_rateio_ln AS
SELECT
  d.company_id,
  d.ln_id,
  bl.name AS ln_name,
  bl.ln_number,
  d.year,
  d.month,
  d.receita_bruta,
  d.margem_contribuicao,
  -- Receita total do mês (todas LNs)
  rt.receita_total,
  -- Custo sede do mês
  rt.custo_sede_total,
  -- RATEIO = Custo Sede × (Receita LN / Receita Total)
  CASE WHEN rt.receita_total > 0
    THEN ROUND(rt.custo_sede_total * d.receita_bruta / rt.receita_total, 2)
    ELSE 0 END AS rateio_sede,
  -- LUCRO REAL = MC - Rateio
  d.margem_contribuicao - CASE WHEN rt.receita_total > 0
    THEN ROUND(rt.custo_sede_total * d.receita_bruta / rt.receita_total, 2)
    ELSE 0 END AS lucro_real
FROM m2_dre_divisional d
JOIN business_lines bl ON bl.id = d.ln_id
JOIN v_kpis_monthly rt ON rt.company_id = d.company_id AND rt.year = d.year AND rt.month = d.month;

-- ========== VIEW: Custo produto com BOM ==========
CREATE OR REPLACE VIEW v_product_cost AS
SELECT
  p.id AS product_id,
  p.company_id,
  p.name AS product_name,
  p.unit,
  p.rateio_pct,
  p.markup_ideal,
  p.preco_praticado,
  -- Custo direto = soma (consumo × custo unitário)
  COALESCE(bom_cost.total_mp, 0) AS custo_mp,
  -- Custo com rateio
  COALESCE(bom_cost.total_mp, 0) * (1 + p.rateio_pct) AS custo_com_rateio,
  -- Preço sugerido
  COALESCE(bom_cost.total_mp, 0) * (1 + p.rateio_pct) * (1 + p.markup_ideal) AS preco_sugerido,
  -- Margem real
  CASE WHEN p.preco_praticado > 0
    THEN ROUND((p.preco_praticado - COALESCE(bom_cost.total_mp, 0) * (1 + p.rateio_pct)) / p.preco_praticado * 100, 1)
    ELSE 0 END AS margem_real_pct
FROM m16_products p
LEFT JOIN LATERAL (
  SELECT SUM(b.consumption_per_unit * i.current_cost) AS total_mp
  FROM m16_bom b
  JOIN m16_insumos i ON i.id = b.insumo_id
  WHERE b.product_id = p.id
) bom_cost ON TRUE;

-- ========== ÍNDICES PARA PERFORMANCE ==========
CREATE INDEX idx_m2_company_period ON m2_dre_divisional(company_id, year, month);
CREATE INDEX idx_m3_company_period ON m3_dre_sede(company_id, year, month);
CREATE INDEX idx_m1_company_period ON m1_balanco(company_id, year, month);
CREATE INDEX idx_m16_insumos_company ON m16_insumos(company_id, erp_code);
CREATE INDEX idx_m16_products_company ON m16_products(company_id);
CREATE INDEX idx_reports_company ON ai_reports(company_id, created_at DESC);
CREATE INDEX idx_companies_org ON companies(org_id);

-- ========== TRIGGER: updated_at automático ==========
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_modtime BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_insumos_modtime BEFORE UPDATE ON m16_insumos FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_products_modtime BEFORE UPDATE ON m16_products FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ========== COMENTÁRIOS ==========
COMMENT ON TABLE organizations IS 'Multi-tenant: cada assessoria/contabilidade é uma organização';
COMMENT ON TABLE companies IS 'Empresas clientes dentro de cada organização';
COMMENT ON TABLE m2_dre_divisional IS 'DRE mensal por linha de negócio — source indica se veio de API ou manual';
COMMENT ON TABLE m16_insumos IS 'Catálogo de matérias-primas — current_cost atualizado via API ContaAzul/Omie';
COMMENT ON TABLE m16_bom IS 'Bill of Materials — composição de cada produto acabado';
COMMENT ON VIEW v_rateio_ln IS 'Rateio proporcional automático — core da metodologia PS Gestão e Capital';
COMMENT ON VIEW v_product_cost IS 'Preço sugerido calculado automaticamente a partir do BOM + rateio + markup';

-- ============================================================
-- EXTENSÃO V2: VISÃO DIÁRIA / SEMANAL / MENSAL / TRIMESTRAL / ANUAL
-- PS Gestão e Capital — Gestão em Tempo Real
-- ============================================================

-- ========== MOVIMENTAÇÕES DIÁRIAS (base de tudo) ==========
CREATE TABLE daily_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ln_id UUID REFERENCES business_lines(id),
  transaction_date DATE NOT NULL,
  
  -- Entradas (vendas do dia)
  faturamento_dia DECIMAL(15,2) DEFAULT 0,
  num_vendas INTEGER DEFAULT 0,
  num_atendimentos INTEGER DEFAULT 0,
  num_orcamentos INTEGER DEFAULT 0,
  novos_clientes INTEGER DEFAULT 0,
  ticket_medio_dia DECIMAL(15,2) DEFAULT 0,

  -- Recebimentos do dia
  recebido_dinheiro DECIMAL(15,2) DEFAULT 0,
  recebido_pix DECIMAL(15,2) DEFAULT 0,
  recebido_debito DECIMAL(15,2) DEFAULT 0,
  recebido_credito DECIMAL(15,2) DEFAULT 0,
  recebido_boleto DECIMAL(15,2) DEFAULT 0,
  recebido_outros DECIMAL(15,2) DEFAULT 0,
  
  -- Saídas do dia
  pagamentos_fornecedores DECIMAL(15,2) DEFAULT 0,
  pagamentos_pessoal DECIMAL(15,2) DEFAULT 0,
  pagamentos_impostos DECIMAL(15,2) DEFAULT 0,
  pagamentos_fixos DECIMAL(15,2) DEFAULT 0,
  pagamentos_outros DECIMAL(15,2) DEFAULT 0,
  
  -- Caixa
  caixa_abertura DECIMAL(15,2) DEFAULT 0,
  caixa_fechamento DECIMAL(15,2) DEFAULT 0,
  
  -- Produção/Serviço (campo livre por segmento)
  producao_quantidade DECIMAL(15,2) DEFAULT 0,
  producao_unidade TEXT DEFAULT 'un',
  producao_meta DECIMAL(15,2) DEFAULT 0,
  
  -- Calculados
  total_recebido DECIMAL(15,2) GENERATED ALWAYS AS (
    recebido_dinheiro + recebido_pix + recebido_debito + recebido_credito + recebido_boleto + recebido_outros
  ) STORED,
  total_pago DECIMAL(15,2) GENERATED ALWAYS AS (
    pagamentos_fornecedores + pagamentos_pessoal + pagamentos_impostos + pagamentos_fixos + pagamentos_outros
  ) STORED,
  
  -- Origem do dado
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual','api_omie','api_contaazul','api_bling','api_stone','api_pix')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(company_id, ln_id, transaction_date)
);

-- Índice para consultas rápidas por período
CREATE INDEX idx_daily_company_date ON daily_transactions(company_id, transaction_date);
CREATE INDEX idx_daily_ln_date ON daily_transactions(ln_id, transaction_date);

-- RLS
ALTER TABLE daily_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own org daily" ON daily_transactions
  FOR ALL USING (company_id IN (SELECT id FROM companies WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

-- ========== VIEW: CONSOLIDAÇÃO SEMANAL (automática) ==========
CREATE OR REPLACE VIEW v_weekly AS
SELECT
  company_id,
  ln_id,
  DATE_TRUNC('week', transaction_date)::DATE AS semana_inicio,
  DATE_TRUNC('week', transaction_date)::DATE + 6 AS semana_fim,
  EXTRACT(WEEK FROM transaction_date) AS num_semana,
  EXTRACT(YEAR FROM transaction_date) AS ano,
  
  -- Faturamento e vendas
  SUM(faturamento_dia) AS faturamento_semana,
  SUM(num_vendas) AS vendas_semana,
  SUM(num_atendimentos) AS atendimentos_semana,
  SUM(num_orcamentos) AS orcamentos_semana,
  SUM(novos_clientes) AS novos_clientes_semana,
  CASE WHEN SUM(num_vendas) > 0 
    THEN ROUND(SUM(faturamento_dia) / SUM(num_vendas), 2) 
    ELSE 0 END AS ticket_medio_semana,
  
  -- Recebimentos
  SUM(total_recebido) AS total_recebido_semana,
  SUM(recebido_dinheiro + recebido_pix + recebido_debito) AS recebido_avista_semana,
  SUM(recebido_credito) AS recebido_credito_semana,
  SUM(recebido_boleto) AS recebido_prazo_semana,
  
  -- Pagamentos
  SUM(total_pago) AS total_pago_semana,
  
  -- Saldo da semana
  SUM(total_recebido) - SUM(total_pago) AS saldo_semana,
  
  -- Caixa (último dia da semana)
  (ARRAY_AGG(caixa_fechamento ORDER BY transaction_date DESC))[1] AS caixa_fim_semana,
  
  -- Produção
  SUM(producao_quantidade) AS producao_semana,
  
  -- Dias com registro
  COUNT(*) AS dias_registrados

FROM daily_transactions
GROUP BY company_id, ln_id, DATE_TRUNC('week', transaction_date), 
         EXTRACT(WEEK FROM transaction_date), EXTRACT(YEAR FROM transaction_date);

-- ========== VIEW: CONSOLIDAÇÃO MENSAL A PARTIR DO DIÁRIO ==========
CREATE OR REPLACE VIEW v_monthly_from_daily AS
SELECT
  company_id,
  ln_id,
  EXTRACT(YEAR FROM transaction_date)::INTEGER AS ano,
  EXTRACT(MONTH FROM transaction_date)::INTEGER AS mes,
  
  SUM(faturamento_dia) AS faturamento_mes,
  SUM(num_vendas) AS vendas_mes,
  SUM(num_atendimentos) AS atendimentos_mes,
  SUM(num_orcamentos) AS orcamentos_mes,
  SUM(novos_clientes) AS novos_clientes_mes,
  CASE WHEN SUM(num_vendas) > 0 
    THEN ROUND(SUM(faturamento_dia) / SUM(num_vendas), 2) 
    ELSE 0 END AS ticket_medio_mes,
  
  SUM(total_recebido) AS total_recebido_mes,
  SUM(total_pago) AS total_pago_mes,
  SUM(total_recebido) - SUM(total_pago) AS saldo_mes,
  
  (ARRAY_AGG(caixa_fechamento ORDER BY transaction_date DESC))[1] AS caixa_fim_mes,
  
  SUM(producao_quantidade) AS producao_mes,
  COUNT(*) AS dias_registrados

FROM daily_transactions
GROUP BY company_id, ln_id, EXTRACT(YEAR FROM transaction_date), EXTRACT(MONTH FROM transaction_date);

-- ========== VIEW: CONSOLIDAÇÃO TRIMESTRAL ==========
CREATE OR REPLACE VIEW v_quarterly AS
SELECT
  company_id,
  ano,
  CASE 
    WHEN mes BETWEEN 1 AND 3 THEN 1
    WHEN mes BETWEEN 4 AND 6 THEN 2
    WHEN mes BETWEEN 7 AND 9 THEN 3
    ELSE 4 
  END AS trimestre,
  
  SUM(faturamento_mes) AS faturamento_trimestre,
  SUM(vendas_mes) AS vendas_trimestre,
  SUM(atendimentos_mes) AS atendimentos_trimestre,
  SUM(novos_clientes_mes) AS novos_clientes_trimestre,
  SUM(total_recebido_mes) AS total_recebido_trimestre,
  SUM(total_pago_mes) AS total_pago_trimestre,
  SUM(total_recebido_mes) - SUM(total_pago_mes) AS saldo_trimestre,
  SUM(producao_mes) AS producao_trimestre,
  SUM(dias_registrados) AS dias_registrados

FROM v_monthly_from_daily
GROUP BY company_id, ano, 
  CASE WHEN mes BETWEEN 1 AND 3 THEN 1 WHEN mes BETWEEN 4 AND 6 THEN 2 WHEN mes BETWEEN 7 AND 9 THEN 3 ELSE 4 END;

-- ========== VIEW: CONSOLIDAÇÃO ANUAL ==========
CREATE OR REPLACE VIEW v_yearly AS
SELECT
  company_id,
  ano,
  
  SUM(faturamento_mes) AS faturamento_ano,
  SUM(vendas_mes) AS vendas_ano,
  SUM(atendimentos_mes) AS atendimentos_ano,
  SUM(novos_clientes_mes) AS novos_clientes_ano,
  SUM(total_recebido_mes) AS total_recebido_ano,
  SUM(total_pago_mes) AS total_pago_ano,
  SUM(total_recebido_mes) - SUM(total_pago_mes) AS saldo_ano,
  SUM(producao_mes) AS producao_ano,
  SUM(dias_registrados) AS dias_registrados

FROM v_monthly_from_daily
GROUP BY company_id, ano;

-- ========== VIEW: PAINEL DIÁRIO DO GESTOR (hoje vs ontem vs meta) ==========
CREATE OR REPLACE VIEW v_daily_dashboard AS
SELECT
  d.company_id,
  d.transaction_date,
  d.ln_id,
  bl.name AS nome_negocio,
  
  -- Dados do dia
  d.faturamento_dia,
  d.num_vendas,
  d.num_atendimentos,
  d.total_recebido,
  d.total_pago,
  d.caixa_fechamento,
  d.producao_quantidade,
  
  -- Comparativo com dia anterior
  LAG(d.faturamento_dia) OVER (PARTITION BY d.company_id, d.ln_id ORDER BY d.transaction_date) AS faturamento_dia_anterior,
  d.faturamento_dia - COALESCE(LAG(d.faturamento_dia) OVER (PARTITION BY d.company_id, d.ln_id ORDER BY d.transaction_date), 0) AS variacao_dia,
  
  -- Acumulado do mês até hoje
  SUM(d.faturamento_dia) OVER (
    PARTITION BY d.company_id, d.ln_id, EXTRACT(YEAR FROM d.transaction_date), EXTRACT(MONTH FROM d.transaction_date) 
    ORDER BY d.transaction_date
  ) AS faturamento_acumulado_mes,
  
  -- Acumulado da semana
  SUM(d.faturamento_dia) OVER (
    PARTITION BY d.company_id, d.ln_id, DATE_TRUNC('week', d.transaction_date)
    ORDER BY d.transaction_date
  ) AS faturamento_acumulado_semana

FROM daily_transactions d
LEFT JOIN business_lines bl ON bl.id = d.ln_id;

-- ========== VIEW: ALERTAS SEMANAIS AUTOMÁTICOS ==========
CREATE OR REPLACE VIEW v_weekly_alerts AS
SELECT
  w.company_id,
  w.semana_inicio,
  w.ano,
  w.num_semana,
  
  -- Faturamento da semana
  SUM(w.faturamento_semana) AS fat_semana_total,
  
  -- Alerta: faturamento caiu vs semana anterior
  SUM(w.faturamento_semana) - COALESCE(LAG(SUM(w.faturamento_semana)) OVER (PARTITION BY w.company_id ORDER BY w.semana_inicio), 0) AS variacao_vs_semana_anterior,
  
  -- Alerta: caixa
  MAX(w.caixa_fim_semana) AS caixa_atual,
  
  -- Alerta: saldo negativo
  CASE WHEN SUM(w.saldo_semana) < 0 THEN true ELSE false END AS semana_negativa,
  
  -- Ticket médio
  CASE WHEN SUM(w.vendas_semana) > 0 
    THEN ROUND(SUM(w.faturamento_semana) / SUM(w.vendas_semana), 2) 
    ELSE 0 END AS ticket_medio

FROM v_weekly w
GROUP BY w.company_id, w.semana_inicio, w.ano, w.num_semana;

-- ========== METAS SEMANAIS E MENSAIS ==========
CREATE TABLE targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ln_id UUID REFERENCES business_lines(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  
  -- Metas mensais
  meta_faturamento_mes DECIMAL(15,2) DEFAULT 0,
  meta_vendas_mes INTEGER DEFAULT 0,
  meta_atendimentos_mes INTEGER DEFAULT 0,
  meta_novos_clientes_mes INTEGER DEFAULT 0,
  meta_producao_mes DECIMAL(15,2) DEFAULT 0,
  meta_ticket_medio DECIMAL(15,2) DEFAULT 0,
  
  -- Metas semanais (calculadas = mensal ÷ 4)
  meta_faturamento_semana DECIMAL(15,2) GENERATED ALWAYS AS (meta_faturamento_mes / 4) STORED,
  meta_vendas_semana INTEGER GENERATED ALWAYS AS (meta_vendas_mes / 4) STORED,
  
  -- Metas diárias (calculadas = mensal ÷ 22 dias úteis)
  meta_faturamento_dia DECIMAL(15,2) GENERATED ALWAYS AS (meta_faturamento_mes / 22) STORED,
  meta_vendas_dia INTEGER GENERATED ALWAYS AS (GREATEST(meta_vendas_mes / 22, 1)) STORED,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, ln_id, year, month)
);

ALTER TABLE targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own org targets" ON targets
  FOR ALL USING (company_id IN (SELECT id FROM companies WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE INDEX idx_targets_company ON targets(company_id, year, month);

-- ========== COMENTÁRIOS ==========
COMMENT ON TABLE daily_transactions IS 'Base de tudo: cada venda, pagamento e produção do dia. API ou manual. O sistema consolida automaticamente em semana/mês/trimestre/ano.';
COMMENT ON VIEW v_weekly IS 'Soma automática dos 7 dias. O gerente olha toda segunda-feira.';
COMMENT ON VIEW v_monthly_from_daily IS 'Soma automática do mês a partir dos registros diários.';
COMMENT ON VIEW v_quarterly IS 'Soma automática do trimestre. Base do relatório do conselho.';
COMMENT ON VIEW v_yearly IS 'Soma automática do ano. Base do planejamento estratégico.';
COMMENT ON VIEW v_daily_dashboard IS 'Painel do dia com comparativo vs dia anterior e acumulados.';
COMMENT ON VIEW v_weekly_alerts IS 'Alertas automáticos semanais: queda de faturamento, caixa baixo, semana negativa.';
COMMENT ON TABLE targets IS 'Metas mensais que se dividem automaticamente em metas semanais e diárias.';

