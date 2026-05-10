-- PR 4.3b-fix: 3 correcoes (threshold + Pronamp + 6 keywords novas)
-- Aplicacao: autonomia pontual (Code Web fora do ar momentaneamente)

-- ETAPA 1: fn_replicar_depara_omie - threshold padronizado >=85
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
      (SELECT psgc_codigo
       FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true
         AND dp.company_id <> g.company_id
       GROUP BY psgc_codigo
       ORDER BY COUNT(*) DESC, MAX(dp.confianca) DESC
       LIMIT 1) AS psgc_codigo_sugerido,
      (SELECT COUNT(DISTINCT company_id)
       FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true
         AND dp.company_id <> g.company_id) AS empresas_confirmadoras,
      (SELECT origem_descricao
       FROM psgc_depara dp
       WHERE dp.origem_codigo = g.origem_codigo
         AND UPPER(dp.origem_sistema) = 'OMIE'
         AND dp.ativo = true
       LIMIT 1) AS origem_descricao_tipica
    FROM gaps_omie g
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado,
    evidencia, rpc_que_gerou
  )
  SELECT
    s.company_id,
    s.origem_codigo,
    COALESCE(s.origem_descricao_tipica, s.origem_codigo),
    'omie',
    s.psgc_codigo_sugerido,
    'omie_replicar',
    CASE
      WHEN s.empresas_confirmadoras >= 2 THEN 90
      WHEN s.empresas_confirmadoras = 1 THEN 85
      ELSE 0
    END,
    s.qtd_lancamentos,
    s.valor_total,
    jsonb_build_object(
      'empresas_que_confirmam', s.empresas_confirmadoras,
      'estrategia_aplicada', 'replicar_omie_de_outras_empresas',
      'origem_descricao_tipica', s.origem_descricao_tipica,
      'threshold_v2', '>=85_alta'
    ),
    'fn_replicar_depara_omie'
  FROM sugestoes s
  WHERE s.psgc_codigo_sugerido IS NOT NULL;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;

  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes
  WHERE estrategia = 'omie_replicar' AND confianca_calculada >= 85;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes
  WHERE estrategia = 'omie_replicar' AND confianca_calculada BETWEEN 70 AND 84;

  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $func$;

-- ETAPA 2: fn_parsear_siga_path - fix Pronamp + 4 keywords novas + threshold
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
      ('CREDITO/RECEITAS OPERACIONAIS', '1.1', 90, 'Receita bruta'),
      ('RECEITAS OPERACIONAIS',         '1.1', 85, 'Receita bruta'),
      ('CREDITOS',                      '1.4', 70, 'Outras receitas'),
      ('RECEITAS NAO OPERACIONAIS',     '9.2', 85, 'Nao-operacionais'),
      ('DESPESAS OPERACIONAIS',         '6.5', 80, 'Operacionais'),
      ('DESPESAS ADMINISTRATIVAS',      '6.5', 85, 'Administrativas'),
      ('DESPESAS COMERCIAIS',           '6.7', 85, 'Vendas/marketing'),
      ('DESPESAS COM VENDAS',           '6.7', 85, 'Vendas/marketing'),
      ('DESPESAS DE VIAGENS',           '6.5', 75, 'Viagens'),
      ('DESPESAS FOLHA DE PAGAMENTO',   '6.1', 90, 'Folha pagamento'),
      ('FOLHA DE PAGAMENTO',            '6.1', 90, 'Folha pagamento'),
      ('PRO-LABORE',                    '6.2', 90, 'Pro-labore'),
      ('PROLABORE',                     '6.2', 90, 'Pro-labore'),
      ('IMPOSTOS/TAXAS',                '3.4', 85, 'Impostos'),
      ('IMPOSTOS',                      '3.4', 80, 'Impostos'),
      ('TAXAS',                         '6.5', 70, 'Taxas adm'),
      ('CUSTO DAS VENDAS',              '4.1', 90, 'CMV'),
      ('CUSTO DOS PRODUTOS VENDIDOS',   '4.1', 90, 'CMV'),
      ('CMV',                           '4.1', 95, 'CMV'),
      ('MAO DE OBRA',                   '4.3', 85, 'Mao obra'),
      ('FRETE',                         '4.5', 80, 'Frete'),
      ('DESPESAS FINANCEIRAS',          '8.2', 90, 'Financeiras'),
      ('RECEITAS FINANCEIRAS',          '8.1', 90, 'Receitas fin'),
      ('JUROS',                         '8.2', 85, 'Juros'),
      ('TARIFAS BANCARIAS',             '8.2', 90, 'Tarifas'),
      ('CONSORCIOS',                    '8.3', 85, 'Consorcios'),
      ('COMISSOES',                     '5.1', 90, 'Comissoes'),
      ('TRANSFERENCIAS',                '0.1', 85, 'Transferencias'),
      ('ADIANTAMENTOS',                 '0.2', 85, 'Adiantamentos'),
      -- NOVAS KEYWORDS PR 4.3b-fix
      ('DESPESAS ARTES GRAFICAS',       '6.7', 85, 'Artes graficas'),
      ('ARTES GRAFICAS',                '6.7', 80, 'Artes graficas'),
      ('DESPESAS FOTO/FILMAGEM/JINGLE', '6.7', 85, 'Audiovisual'),
      ('FOTO/FILMAGEM/JINGLE',          '6.7', 80, 'Audiovisual')
    ) AS m(area, psgc, conf, descricao)
  ),
  sugestoes_base AS (
    SELECT
      g.company_id, g.path_completo, g.area_principal, g.subarea,
      g.qtd_lancamentos, g.valor_total,
      m.psgc AS psgc_area, m.conf AS conf_area, m.descricao AS descricao_area,
      -- FIX PRONAMP: override por subarea
      CASE
        WHEN UPPER(g.subarea) ~ '(PRONAMP|FINANCIAMENTO|EMPRESTIMO|EMPRÉSTIMO|GIRO|FINANCING|LOAN)'
          THEN '8.2'
        ELSE m.psgc
      END AS psgc_final,
      CASE
        WHEN UPPER(g.subarea) ~ '(PRONAMP|FINANCIAMENTO|EMPRESTIMO|EMPRÉSTIMO|GIRO|FINANCING|LOAN)'
          THEN 90
        ELSE m.conf
      END AS conf_final,
      CASE
        WHEN UPPER(g.subarea) ~ '(PRONAMP|FINANCIAMENTO|EMPRESTIMO|EMPRÉSTIMO|GIRO|FINANCING|LOAN)'
          THEN 'override_financiamento_subarea'
        ELSE 'mapa_area_principal'
      END AS metodo
    FROM gaps_siga g
    JOIN mapa_siga m ON UPPER(g.area_principal) = m.area
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado,
    evidencia, rpc_que_gerou
  )
  SELECT
    s.company_id, NULL, s.path_completo, 'siga', s.psgc_final, 'siga_path',
    s.conf_final, s.qtd_lancamentos, s.valor_total,
    jsonb_build_object(
      'area_parseada', s.area_principal,
      'subarea_parseada', s.subarea,
      'mapa_aplicado', s.descricao_area,
      'psgc_area', s.psgc_area,
      'psgc_final', s.psgc_final,
      'metodo', s.metodo,
      'fix_pronamp_aplicado', (s.metodo = 'override_financiamento_subarea')
    ),
    'fn_parsear_siga_path'
  FROM sugestoes_base s;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;

  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes
  WHERE estrategia = 'siga_path' AND confianca_calculada >= 85;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes
  WHERE estrategia = 'siga_path' AND confianca_calculada BETWEEN 70 AND 84;

  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $func$;

-- ETAPA 3: fn_sugerir_mapeamento_texto_livre - 4 keywords novas
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
      ('CSLL',                     '10.2', 95),
      -- NOVAS KEYWORDS PR 4.3b-fix
      ('INVESTIMENTOS EM IMOBILIZADO', '9.1', 90),
      ('IMOBILIZADO',              '9.1', 85),
      ('INVESTIMENTOS',            '9.1', 75),
      ('ATIVOS',                   '9.1', 70)
    ) AS m(keyword, psgc, conf)
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado,
    evidencia, rpc_que_gerou
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
