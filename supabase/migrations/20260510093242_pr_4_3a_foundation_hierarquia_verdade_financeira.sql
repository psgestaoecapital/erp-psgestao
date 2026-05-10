-- ═══════════════════════════════════════════════════════════════
-- PR 4.3a: Foundation Hierarquia da Verdade Financeira
-- Onda 4 | Aplicacao Regra #36
-- Data: 10/05/2026
--
-- ESCOPO (5 etapas):
-- 1. 3 campos novos em psgc_dre (regime, data_referencia, origem_sistema_lancamento)
-- 2. Tabela legislacao_vigente (catalogo de aliquotas + seed 7 federais)
-- 3. View v_categorias_sem_depara (gaps de mapeamento PSGC)
-- 4. View v_categorias_padrao_por_sistema (analise de padroes Omie/SIGA/manual)
-- 5. Auditoria pos-aplicacao
--
-- IDEMPOTENTE | ZERO impacto em DRE atual (so adiciona)
-- AJUSTE: idx_legislacao_vigentes nao usa CURRENT_DATE no predicate
--         (restricao IMMUTABLE de partial index no PG); vigente_ate na chave.
-- ═══════════════════════════════════════════════════════════════

-- ETAPA 1: 3 campos novos em psgc_dre
ALTER TABLE public.psgc_dre
  ADD COLUMN IF NOT EXISTS regime text DEFAULT 'competencia'
    CHECK (regime IN ('competencia', 'caixa', 'legacy_v0', 'projecao'));

ALTER TABLE public.psgc_dre
  ADD COLUMN IF NOT EXISTS data_referencia date;

ALTER TABLE public.psgc_dre
  ADD COLUMN IF NOT EXISTS origem_sistema_lancamento text;

COMMENT ON COLUMN public.psgc_dre.regime IS
'REGIME CONTABIL (nao tributario). competencia=data_emissao (DRE padrao CPC 00), caixa=data_pagamento (fluxo). legacy_v0=dados pre-Regra #36 (a migrar). PR 4.3a Regra #36.';

COMMENT ON COLUMN public.psgc_dre.data_referencia IS
'Data usada na agregacao (data_emissao se competencia, data_pagamento se caixa). PR 4.3a.';

COMMENT ON COLUMN public.psgc_dre.origem_sistema_lancamento IS
'Sistema fonte dos lancamentos (omie/siga/hooked/manual/nibo). Para Truth Auditor paridade externa. PR 4.3a.';

UPDATE public.psgc_dre
SET regime = 'legacy_v0'
WHERE regime IS NULL OR regime = 'competencia';

CREATE INDEX IF NOT EXISTS idx_psgc_dre_regime
  ON public.psgc_dre(regime, company_id, ano, mes);

CREATE INDEX IF NOT EXISTS idx_psgc_dre_origem
  ON public.psgc_dre(origem_sistema_lancamento, company_id)
  WHERE origem_sistema_lancamento IS NOT NULL;

-- ETAPA 2: legislacao_vigente
CREATE TABLE IF NOT EXISTS public.legislacao_vigente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN (
    'icms', 'icms_st', 'pis', 'cofins', 'pis_cofins', 'iss', 'ipi',
    'simples_nacional', 'lucro_real', 'lucro_presumido',
    'ibs_estadual', 'ibs_municipal', 'cbs',
    'irpj', 'csll', 'inss_patronal', 'fgts',
    'convenio_confaz', 'solucao_consulta_rfb', 'outro'
  )),
  abrangencia text NOT NULL CHECK (abrangencia IN ('federal', 'estadual', 'municipal')),
  uf text CHECK (uf ~ '^[A-Z]{2}$'),
  municipio text,
  codigo_referencia text,
  cnae text,
  ncm text,
  aliquota numeric(8,4),
  valor_fixo numeric(20,4),
  vigente_de date NOT NULL,
  vigente_ate date,
  nome_legislacao text NOT NULL,
  descricao text,
  fonte_oficial text,
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  criado_em timestamptz DEFAULT NOW(),
  atualizado_em timestamptz DEFAULT NOW(),
  CONSTRAINT chk_data_vigencia CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de)
);

COMMENT ON TABLE public.legislacao_vigente IS
'Catalogo de aliquotas e regras tributarias vigentes. Suporta Reforma Tributaria 2027 (IBS+CBS). Aplicacao Regra #36 Nivel 4. PR 4.3a.';

CREATE INDEX IF NOT EXISTS idx_legislacao_tipo_data
  ON public.legislacao_vigente(tipo, vigente_de DESC, vigente_ate);

CREATE INDEX IF NOT EXISTS idx_legislacao_uf
  ON public.legislacao_vigente(uf, tipo) WHERE uf IS NOT NULL;

-- AJUSTE: removido CURRENT_DATE (nao IMMUTABLE), vigente_ate movido p/ chave
CREATE INDEX IF NOT EXISTS idx_legislacao_vigentes
  ON public.legislacao_vigente(tipo, vigente_de, vigente_ate)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_legislacao_ncm
  ON public.legislacao_vigente(ncm, uf) WHERE ncm IS NOT NULL;

ALTER TABLE public.legislacao_vigente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_can_read_legislacao" ON public.legislacao_vigente;
CREATE POLICY "auth_can_read_legislacao" ON public.legislacao_vigente
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_role_writes_legislacao" ON public.legislacao_vigente;
CREATE POLICY "service_role_writes_legislacao" ON public.legislacao_vigente
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_legislacao_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_legislacao_atualizado_em ON public.legislacao_vigente;
CREATE TRIGGER trg_legislacao_atualizado_em
BEFORE UPDATE ON public.legislacao_vigente
FOR EACH ROW EXECUTE FUNCTION public.fn_legislacao_atualizado_em();

-- Seed inicial: 7 aliquotas federais conhecidas
INSERT INTO public.legislacao_vigente (
  tipo, abrangencia, aliquota, vigente_de, nome_legislacao, descricao, fonte_oficial
) VALUES
  ('pis', 'federal', 0.0065, '2003-12-01', 'PIS Cumulativo Lucro Presumido',
   'Aliquota PIS regime cumulativo (lucro presumido)', 'Lei 9.715/1998'),
  ('pis', 'federal', 0.0165, '2002-12-01', 'PIS Nao-Cumulativo Lucro Real',
   'Aliquota PIS regime nao-cumulativo (lucro real)', 'Lei 10.637/2002'),
  ('cofins', 'federal', 0.0300, '2003-12-01', 'COFINS Cumulativo Lucro Presumido',
   'Aliquota COFINS regime cumulativo (lucro presumido)', 'LC 70/1991'),
  ('cofins', 'federal', 0.0760, '2003-12-01', 'COFINS Nao-Cumulativo Lucro Real',
   'Aliquota COFINS regime nao-cumulativo (lucro real)', 'Lei 10.833/2003'),
  ('csll', 'federal', 0.0900, '1996-01-01', 'CSLL padrao',
   'Contribuicao Social sobre o Lucro Liquido', 'Lei 7.689/1988'),
  ('irpj', 'federal', 0.1500, '1996-01-01', 'IRPJ aliquota basica',
   'IRPJ aliquota basica (lucro real ou presumido)', 'Lei 9.249/1995'),
  ('irpj', 'federal', 0.1000, '1996-01-01', 'IRPJ adicional 10%',
   'IRPJ adicional 10% sobre lucro mensal acima de R$ 20.000', 'Lei 9.249/1995')
ON CONFLICT DO NOTHING;

-- ETAPA 3: View v_categorias_sem_depara
DROP VIEW IF EXISTS public.v_categorias_sem_depara CASCADE;

CREATE VIEW public.v_categorias_sem_depara AS
WITH categorias_em_uso AS (
  SELECT
    company_id,
    'erp_receber'::text AS tabela_origem,
    ref_externa_sistema,
    categoria,
    COUNT(*) AS qtd_lancamentos,
    SUM(valor) AS valor_total,
    MIN(data_emissao) AS primeira_ocorrencia,
    MAX(data_emissao) AS ultima_ocorrencia
  FROM erp_receber
  WHERE categoria IS NOT NULL AND categoria <> ''
  GROUP BY company_id, ref_externa_sistema, categoria

  UNION ALL

  SELECT
    company_id,
    'erp_pagar'::text,
    ref_externa_sistema,
    categoria,
    COUNT(*),
    SUM(valor),
    MIN(data_emissao),
    MAX(data_emissao)
  FROM erp_pagar
  WHERE categoria IS NOT NULL AND categoria <> ''
  GROUP BY company_id, ref_externa_sistema, categoria
)
SELECT
  c.nome_fantasia AS empresa,
  cat.company_id,
  cat.tabela_origem,
  COALESCE(cat.ref_externa_sistema, 'manual') AS sistema_origem,
  cat.categoria,
  cat.qtd_lancamentos,
  ROUND(cat.valor_total::numeric, 2) AS valor_total,
  cat.primeira_ocorrencia,
  cat.ultima_ocorrencia,
  CASE
    WHEN dp_codigo.psgc_codigo IS NOT NULL THEN 'tem_depara_via_codigo'
    WHEN dp_descricao.psgc_codigo IS NOT NULL THEN 'tem_depara_via_descricao'
    ELSE 'sem_depara'
  END AS status_mapeamento,
  (SELECT psgc_codigo
   FROM psgc_depara dp_other
   WHERE dp_other.origem_descricao ILIKE '%' || cat.categoria || '%'
     AND dp_other.ativo = true
   LIMIT 1) AS psgc_codigo_sugerido_outra_empresa
FROM categorias_em_uso cat
JOIN companies c ON c.id = cat.company_id
LEFT JOIN psgc_depara dp_codigo ON dp_codigo.company_id = cat.company_id
  AND dp_codigo.origem_codigo = cat.categoria
  AND dp_codigo.ativo = true
LEFT JOIN psgc_depara dp_descricao ON dp_descricao.company_id = cat.company_id
  AND LOWER(dp_descricao.origem_descricao) = LOWER(cat.categoria)
  AND dp_descricao.ativo = true
WHERE c.is_active = true;

COMMENT ON VIEW public.v_categorias_sem_depara IS
'Mapa de gaps de mapeamento PSGC. Identifica quais categorias TEM/NAO TEM depara. PR 4.3a.';

-- ETAPA 4: View v_categorias_padrao_por_sistema
DROP VIEW IF EXISTS public.v_categorias_padrao_por_sistema CASCADE;

CREATE VIEW public.v_categorias_padrao_por_sistema AS
WITH analise AS (
  SELECT
    COALESCE(ref_externa_sistema, 'manual') AS sistema,
    'erp_receber'::text AS tabela,
    COUNT(*) AS total_lancamentos,
    COUNT(DISTINCT categoria) AS categorias_distintas,
    COUNT(*) FILTER (WHERE categoria ~ '^[0-9]+(\.[0-9]+)*$') AS com_codigo_estruturado,
    COUNT(*) FILTER (WHERE categoria LIKE '%>%' OR categoria LIKE '%/%') AS com_hierarquia_path,
    COUNT(*) FILTER (WHERE categoria !~ '^[0-9]+(\.[0-9]+)*$'
                     AND categoria NOT LIKE '%>%'
                     AND categoria NOT LIKE '%/%') AS texto_livre
  FROM erp_receber
  WHERE categoria IS NOT NULL AND categoria <> ''
  GROUP BY ref_externa_sistema

  UNION ALL

  SELECT
    COALESCE(ref_externa_sistema, 'manual'),
    'erp_pagar'::text,
    COUNT(*),
    COUNT(DISTINCT categoria),
    COUNT(*) FILTER (WHERE categoria ~ '^[0-9]+(\.[0-9]+)*$'),
    COUNT(*) FILTER (WHERE categoria LIKE '%>%' OR categoria LIKE '%/%'),
    COUNT(*) FILTER (WHERE categoria !~ '^[0-9]+(\.[0-9]+)*$'
                     AND categoria NOT LIKE '%>%'
                     AND categoria NOT LIKE '%/%')
  FROM erp_pagar
  WHERE categoria IS NOT NULL AND categoria <> ''
  GROUP BY ref_externa_sistema
)
SELECT
  sistema,
  SUM(total_lancamentos) AS total_lancamentos,
  SUM(categorias_distintas) AS categorias_distintas,
  SUM(com_codigo_estruturado) AS com_codigo,
  SUM(com_hierarquia_path) AS com_path,
  SUM(texto_livre) AS texto_livre,
  CASE
    WHEN SUM(com_codigo_estruturado) > SUM(total_lancamentos) * 0.8
      THEN 'mapear_por_origem_codigo_omie'
    WHEN SUM(com_hierarquia_path) > SUM(total_lancamentos) * 0.5
      THEN 'parsear_path_e_mapear_ultimo_segmento_siga'
    ELSE 'mapear_por_origem_descricao_normalizada'
  END AS estrategia_mapeamento_sugerida
FROM analise
GROUP BY sistema
ORDER BY SUM(total_lancamentos) DESC;

COMMENT ON VIEW public.v_categorias_padrao_por_sistema IS
'Analise de padroes de categoria por sistema fonte. Identifica estrategia de mapeamento. PR 4.3a.';
