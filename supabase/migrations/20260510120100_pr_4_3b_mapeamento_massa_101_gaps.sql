-- ═══════════════════════════════════════════════════════════════
-- PR 4.3b: Mapeamento em Massa dos 101 Gaps - 3 Estrategias
-- Onda 4 Truth Auditor | Aplicacao Regra #36
-- Data: 10/05/2026
--
-- OBJETIVO:
-- Gerar SUGESTOES de mapeamento PSGC para gaps identificados no PR 4.3a.
-- 3 estrategias paralelas:
--   A) Omie copia entre empresas (fn_replicar_depara_omie)
--   B) SIGA path parser AREA>SUBAREA (fn_parsear_siga_path)
--   C) Texto livre fuzzy match com keywords PT-BR (fn_sugerir_mapeamento_texto_livre)
--
-- CRITICO: este PR NAO altera psgc_depara real.
-- Sugestoes ficam em staging psgc_depara_sugestoes para CEO aprovar.
-- Aplicacao em producao sera no PR 4.3c apos aprovacao manual.
--
-- IDEMPOTENTE | CUSTO R$ 0/mes | IMPACTO PROD: ZERO
-- ═══════════════════════════════════════════════════════════════

-- ETAPA 1: Tabela psgc_depara_sugestoes (staging)
CREATE TABLE IF NOT EXISTS public.psgc_depara_sugestoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  origem_codigo text,
  origem_descricao text,
  origem_sistema text NOT NULL,
  psgc_codigo_sugerido text NOT NULL,
  estrategia text NOT NULL CHECK (estrategia IN ('omie_replicar', 'siga_path', 'texto_livre_fuzzy', 'manual')),
  confianca_calculada integer NOT NULL DEFAULT 0 CHECK (confianca_calculada BETWEEN 0 AND 100),
  evidencia jsonb DEFAULT '{}'::jsonb,
  qtd_lancamentos_afetados integer DEFAULT 0,
  valor_total_afetado numeric(20,4) DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'ajustada', 'aplicada')),
  psgc_codigo_aprovado text,
  aprovado_por uuid REFERENCES public.users(id),
  aprovado_em timestamptz,
  observacao_revisao text,
  gerada_em timestamptz DEFAULT NOW(),
  rpc_que_gerou text,
  CONSTRAINT chk_aprovado_tem_codigo CHECK (
    (status NOT IN ('aprovada', 'ajustada', 'aplicada')) OR psgc_codigo_aprovado IS NOT NULL
  )
);

COMMENT ON TABLE public.psgc_depara_sugestoes IS
'Staging de sugestoes de mapeamento PSGC. CEO aprova manualmente antes de virar producao em psgc_depara. PR 4.3b da Onda 4.';

CREATE INDEX IF NOT EXISTS idx_sugestoes_status
  ON public.psgc_depara_sugestoes(status, valor_total_afetado DESC)
  WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_sugestoes_company
  ON public.psgc_depara_sugestoes(company_id, status);

CREATE INDEX IF NOT EXISTS idx_sugestoes_estrategia
  ON public.psgc_depara_sugestoes(estrategia, confianca_calculada DESC);

ALTER TABLE public.psgc_depara_sugestoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_can_read_sugestoes" ON public.psgc_depara_sugestoes;
CREATE POLICY "auth_can_read_sugestoes" ON public.psgc_depara_sugestoes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_role_writes_sugestoes" ON public.psgc_depara_sugestoes;
CREATE POLICY "service_role_writes_sugestoes" ON public.psgc_depara_sugestoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ETAPA 2: RPC fn_replicar_depara_omie (Estrategia A)
-- Para gaps Omie, busca mesmo origem_codigo em outras empresas e replica psgc_codigo.
-- NOTA: thresholds desta versao foram ajustados em 4.3b-fix (alta>=85).

CREATE OR REPLACE FUNCTION public.fn_replicar_depara_omie()
RETURNS TABLE (
  qtd_sugestoes_geradas integer,
  qtd_alta_confianca integer,
  qtd_media_confianca integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_qtd_total INT := 0;
  v_qtd_alta INT := 0;
  v_qtd_media INT := 0;
BEGIN
  DELETE FROM psgc_depara_sugestoes
  WHERE estrategia = 'omie_replicar' AND status = 'pendente';

  WITH gaps_omie AS (
    SELECT DISTINCT
      v.company_id,
      v.categoria AS origem_codigo,
      v.empresa,
      v.qtd_lancamentos,
      v.valor_total
    FROM v_categorias_sem_depara v
    WHERE v.status_mapeamento = 'sem_depara'
      AND UPPER(v.sistema_origem) = 'OMIE'
  ),
  sugestoes AS (
    SELECT
      g.company_id,
      g.origem_codigo,
      g.qtd_lancamentos,
      g.valor_total,
      (SELECT psgc_codigo FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true AND dp.company_id <> g.company_id
       GROUP BY psgc_codigo
       ORDER BY COUNT(*) DESC, MAX(dp.confianca) DESC LIMIT 1) AS psgc_codigo_sugerido,
      (SELECT COUNT(DISTINCT company_id) FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true AND dp.company_id <> g.company_id) AS empresas_confirmadoras,
      (SELECT origem_descricao FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true LIMIT 1) AS origem_descricao_tipica
    FROM gaps_omie g
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado, evidencia, rpc_que_gerou
  )
  SELECT
    s.company_id, s.origem_codigo,
    COALESCE(s.origem_descricao_tipica, s.origem_codigo),
    'omie', s.psgc_codigo_sugerido, 'omie_replicar',
    CASE
      WHEN s.empresas_confirmadoras >= 2 THEN 90
      WHEN s.empresas_confirmadoras = 1 THEN 70
      ELSE 0
    END,
    s.qtd_lancamentos, s.valor_total,
    jsonb_build_object(
      'empresas_que_confirmam', s.empresas_confirmadoras,
      'estrategia_aplicada', 'replicar_omie_de_outras_empresas',
      'origem_descricao_tipica', s.origem_descricao_tipica
    ),
    'fn_replicar_depara_omie'
  FROM sugestoes s
  WHERE s.psgc_codigo_sugerido IS NOT NULL;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;
  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes
    WHERE estrategia = 'omie_replicar' AND confianca_calculada >= 90;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes
    WHERE estrategia = 'omie_replicar' AND confianca_calculada BETWEEN 70 AND 89;
  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $func$;

COMMENT ON FUNCTION public.fn_replicar_depara_omie() IS
'Estrategia A: replica psgc_codigo Omie de outras empresas que ja tem mapeamento. PR 4.3b.';

-- ETAPA 3: RPC fn_parsear_siga_path (Estrategia B)
-- SIGA usa "AREA > SUBAREA". Mapa estatico AREA SIGA -> psgc_codigo.

CREATE OR REPLACE FUNCTION public.fn_parsear_siga_path()
RETURNS TABLE (
  qtd_sugestoes_geradas integer,
  qtd_alta_confianca integer,
  qtd_media_confianca integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_qtd_total INT := 0;
  v_qtd_alta INT := 0;
  v_qtd_media INT := 0;
BEGIN
  DELETE FROM psgc_depara_sugestoes
  WHERE estrategia = 'siga_path' AND status = 'pendente';

  WITH gaps_siga AS (
    SELECT
      v.company_id, v.empresa,
      v.categoria AS path_completo,
      TRIM(SPLIT_PART(v.categoria, '>', 1)) AS area_principal,
      TRIM(SPLIT_PART(v.categoria, '>', 2)) AS subarea,
      v.qtd_lancamentos, v.valor_total
    FROM v_categorias_sem_depara v
    WHERE v.status_mapeamento = 'sem_depara'
      AND v.sistema_origem = 'siga'
      AND v.categoria LIKE '%>%'
  ),
  mapa_siga AS (
    SELECT * FROM (VALUES
      ('CREDITO/RECEITAS OPERACIONAIS', '1.1', 90, 'Receita bruta mercadorias/servicos'),
      ('RECEITAS OPERACIONAIS',         '1.1', 85, 'Receita bruta'),
      ('CREDITOS',                      '1.4', 70, 'Outras receitas operacionais'),
      ('RECEITAS NAO OPERACIONAIS',     '9.2', 85, 'Receitas nao-operacionais'),
      ('DESPESAS OPERACIONAIS',         '6.5', 80, 'Despesas operacionais gerais'),
      ('DESPESAS ADMINISTRATIVAS',      '6.5', 85, 'Despesas administrativas'),
      ('DESPESAS COMERCIAIS',           '6.7', 85, 'Vendas e marketing'),
      ('DESPESAS COM VENDAS',           '6.7', 85, 'Vendas e marketing'),
      ('DESPESAS DE VIAGENS',           '6.5', 75, 'Viagens'),
      ('DESPESAS FOLHA DE PAGAMENTO',   '6.1', 90, 'Folha de pagamento'),
      ('FOLHA DE PAGAMENTO',            '6.1', 90, 'Folha de pagamento'),
      ('PRO-LABORE',                    '6.2', 90, 'Pro-labore'),
      ('PROLABORE',                     '6.2', 90, 'Pro-labore'),
      ('IMPOSTOS/TAXAS',                '3.4', 85, 'Impostos sobre receita'),
      ('IMPOSTOS',                      '3.4', 80, 'Impostos sobre receita'),
      ('TAXAS',                         '6.5', 70, 'Taxas administrativas'),
      ('CUSTO DAS VENDAS',              '4.1', 90, 'CMV'),
      ('CUSTO DOS PRODUTOS VENDIDOS',   '4.1', 90, 'CMV'),
      ('CMV',                           '4.1', 95, 'CMV'),
      ('MAO DE OBRA',                   '4.3', 85, 'Mao de obra direta'),
      ('FRETE',                         '4.5', 80, 'Frete'),
      ('DESPESAS FINANCEIRAS',          '8.2', 90, 'Despesas financeiras'),
      ('RECEITAS FINANCEIRAS',          '8.1', 90, 'Receitas financeiras'),
      ('JUROS',                         '8.2', 85, 'Juros'),
      ('TARIFAS BANCARIAS',             '8.2', 90, 'Tarifas bancarias'),
      ('CONSORCIOS',                    '8.3', 85, 'Consorcios e previdencia'),
      ('COMISSOES',                     '5.1', 90, 'Comissoes'),
      ('TRANSFERENCIAS',                '0.1', 85, 'Transferencias entre contas'),
      ('ADIANTAMENTOS',                 '0.2', 85, 'Adiantamentos')
    ) AS m(area, psgc, conf, descricao)
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado, evidencia, rpc_que_gerou
  )
  SELECT
    g.company_id, NULL, g.path_completo, 'siga',
    m.psgc, 'siga_path', m.conf,
    g.qtd_lancamentos, g.valor_total,
    jsonb_build_object(
      'area_parseada', g.area_principal,
      'subarea_parseada', g.subarea,
      'mapa_aplicado', m.descricao,
      'estrategia', 'parser_siga_path_AREA_SUBAREA'
    ),
    'fn_parsear_siga_path'
  FROM gaps_siga g
  JOIN mapa_siga m ON UPPER(g.area_principal) = m.area;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;
  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes
    WHERE estrategia = 'siga_path' AND confianca_calculada >= 90;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes
    WHERE estrategia = 'siga_path' AND confianca_calculada BETWEEN 70 AND 89;
  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $func$;

COMMENT ON FUNCTION public.fn_parsear_siga_path() IS
'Estrategia B: parser de path SIGA (AREA > SUBAREA) mapeando para PSGC. PR 4.3b.';

-- ETAPA 4: RPC fn_sugerir_mapeamento_texto_livre (Estrategia C)
CREATE OR REPLACE FUNCTION public.fn_sugerir_mapeamento_texto_livre()
RETURNS TABLE (
  qtd_sugestoes_geradas integer,
  qtd_alta_confianca integer,
  qtd_media_confianca integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_qtd_total INT := 0;
  v_qtd_alta INT := 0;
  v_qtd_media INT := 0;
BEGIN
  DELETE FROM psgc_depara_sugestoes
  WHERE estrategia = 'texto_livre_fuzzy' AND status = 'pendente';

  WITH gaps_texto AS (
    SELECT
      v.company_id, v.empresa, v.categoria,
      v.qtd_lancamentos, v.valor_total,
      v.psgc_codigo_sugerido_outra_empresa AS sugestao_view
    FROM v_categorias_sem_depara v
    WHERE v.status_mapeamento = 'sem_depara'
      AND v.sistema_origem IN ('manual', 'erp_lancamentos', 'contrato_recorrente')
  ),
  mapa_texto AS (
    SELECT * FROM (VALUES
      ('RECEITA',                  '1.1', 80),
      ('VENDAS',                   '1.1', 80),
      ('FATURAMENTO',              '1.1', 75),
      ('CUSTO DAS VENDAS',         '4.1', 90),
      ('CUSTO DE VENDAS',          '4.1', 90),
      ('CMV',                      '4.1', 95),
      ('MERCADORIAS',              '4.2', 75),
      ('DESPESAS COM PESSOAL',     '6.1', 90),
      ('FOLHA',                    '6.1', 80),
      ('SALARIOS',                 '6.1', 85),
      ('PRO-LABORE',               '6.2', 90),
      ('DESPESAS ADMINISTRATIVAS', '6.5', 90),
      ('ADMINISTRATIVAS',          '6.5', 85),
      ('ADMINISTRATIVO',           '6.5', 80),
      ('DESPESAS COMERCIAIS',      '6.7', 85),
      ('COMERCIAIS',               '6.7', 75),
      ('MARKETING',                '6.7', 85),
      ('DESPESAS FINANCEIRAS',     '8.2', 90),
      ('RECEITAS FINANCEIRAS',     '8.1', 90),
      ('IMPOSTOS',                 '3.4', 80),
      ('TRIBUTOS',                 '3.4', 80),
      ('SIMPLES',                  '3.4', 85),
      ('IRPJ',                     '10.1', 95),
      ('CSLL',                     '10.2', 95)
    ) AS m(keyword, psgc, conf)
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado, evidencia, rpc_que_gerou
  )
  SELECT DISTINCT ON (g.company_id, g.categoria)
    g.company_id, NULL, g.categoria, 'manual',
    COALESCE(g.sugestao_view, m.psgc), 'texto_livre_fuzzy',
    CASE
      WHEN g.sugestao_view IS NOT NULL THEN 85
      WHEN m.psgc IS NOT NULL THEN m.conf
      ELSE 0
    END,
    g.qtd_lancamentos, g.valor_total,
    jsonb_build_object(
      'sugestao_outra_empresa', g.sugestao_view,
      'keyword_matched', m.keyword,
      'estrategia',
        CASE
          WHEN g.sugestao_view IS NOT NULL THEN 'match_outra_empresa_psgestao'
          ELSE 'keyword_fuzzy_pt_br'
        END
    ),
    'fn_sugerir_mapeamento_texto_livre'
  FROM gaps_texto g
  LEFT JOIN mapa_texto m ON UPPER(g.categoria) LIKE '%' || m.keyword || '%'
  WHERE COALESCE(g.sugestao_view, m.psgc) IS NOT NULL
  ORDER BY g.company_id, g.categoria, m.conf DESC NULLS LAST;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;
  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes
    WHERE estrategia = 'texto_livre_fuzzy' AND confianca_calculada >= 85;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes
    WHERE estrategia = 'texto_livre_fuzzy' AND confianca_calculada BETWEEN 70 AND 84;
  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $func$;

COMMENT ON FUNCTION public.fn_sugerir_mapeamento_texto_livre() IS
'Estrategia C: fuzzy match texto livre (erp_lancamentos) com sugestao cruzada e keywords PT-BR. PR 4.3b.';

-- ETAPA 5: View v_depara_sugestoes_pendentes (CEO revisa)
DROP VIEW IF EXISTS public.v_depara_sugestoes_pendentes CASCADE;

CREATE VIEW public.v_depara_sugestoes_pendentes AS
SELECT
  s.id,
  c.nome_fantasia AS empresa,
  s.origem_sistema,
  COALESCE(s.origem_codigo, '(sem codigo)') AS origem_codigo,
  s.origem_descricao,
  s.psgc_codigo_sugerido,
  s.estrategia,
  s.confianca_calculada,
  CASE
    WHEN s.confianca_calculada >= 85 THEN 'alta'
    WHEN s.confianca_calculada >= 70 THEN 'media'
    ELSE 'baixa'
  END AS nivel_confianca,
  s.qtd_lancamentos_afetados,
  ROUND(s.valor_total_afetado::numeric, 2) AS "valor_total_R$",
  s.evidencia,
  s.status,
  s.gerada_em
FROM psgc_depara_sugestoes s
JOIN companies c ON c.id = s.company_id
WHERE s.status = 'pendente'
ORDER BY s.valor_total_afetado DESC NULLS LAST;

COMMENT ON VIEW public.v_depara_sugestoes_pendentes IS
'View de revisao para CEO aprovar sugestoes antes de virarem psgc_depara. PR 4.3b.';
