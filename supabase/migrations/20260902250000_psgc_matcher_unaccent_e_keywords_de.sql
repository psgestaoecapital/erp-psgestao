-- Matcher do plano de contas: normalizar acento na COMPARAÇÃO (não reescrever o dado) + fechar
-- lacunas de keyword com as variantes "de". Achado do CEO: nomes naturais em PT-BR não casavam.
--
-- Auditoria das 5 funções que usam keywords (RD-38):
--   fn_psgc_sugerir_conta      já normaliza (fn_remove_acentos nos dois lados)  -> OK, sem mudança
--   fn_psgc_classificar_ln     já normaliza (business_lines)                    -> OK, sem mudança
--   fn_psgc_cadastrar_ln       só GRAVA keywords, não compara                   -> OK (normaliza-se na
--                                                                                   comparação, não no dado)
--   fn_sugerir_mapeamento_texto_livre   comparava UPPER(cat) LIKE '%kw%' literal -> BUG, corrigido aqui
--   fn_parsear_siga_path                comparava UPPER(area) = area literal      -> BUG, corrigido aqui
--
-- Os dois nomes que ainda não casavam ("Retirada de Lucros", "Distribuição de Resultado aos Sócios")
-- eram LACUNA DE KEYWORD, não acento — resolvidos adicionando as variantes à 0.3.

-- (A) fecha as lacunas de keyword na 0.3 (idempotente)
UPDATE public.psgc_contas
   SET keywords = (SELECT array_agg(DISTINCT k)
                   FROM unnest(keywords || ARRAY['retirada de lucros','distribuicao de resultado']) k),
       versao = versao + 1, updated_at = now()
 WHERE codigo = '0.3'
   AND NOT (keywords @> ARRAY['retirada de lucros','distribuicao de resultado']);

-- (B) fn_sugerir_mapeamento_texto_livre: comparar sem acento dos dois lados (fn_remove_acentos)
CREATE OR REPLACE FUNCTION public.fn_sugerir_mapeamento_texto_livre()
 RETURNS TABLE(qtd_sugestoes_geradas integer, qtd_alta_confianca integer, qtd_media_confianca integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_qtd_total INT := 0; v_qtd_alta INT := 0; v_qtd_media INT := 0;
BEGIN
  DELETE FROM psgc_depara_sugestoes WHERE estrategia = 'texto_livre_fuzzy' AND status = 'pendente';

  WITH gaps_texto AS (
    SELECT v.company_id, v.empresa, v.categoria, v.qtd_lancamentos, v.valor_total,
           v.psgc_codigo_sugerido_outra_empresa AS sugestao_view
    FROM v_categorias_sem_depara v
    WHERE v.status_mapeamento = 'sem_depara'
      AND v.sistema_origem IN ('manual', 'erp_lancamentos', 'contrato_recorrente')
  ),
  mapa_texto AS (
    SELECT * FROM (VALUES
      ('RECEITA','1.1',80),('VENDAS','1.1',80),('FATURAMENTO','1.1',75),
      ('CUSTO DAS VENDAS','4.1',90),('CUSTO DE VENDAS','4.1',90),('CMV','4.1',95),
      ('MERCADORIAS','4.2',75),('DESPESAS COM PESSOAL','6.1',90),('FOLHA','6.1',80),
      ('SALARIOS','6.1',85),('PRO-LABORE','6.2',90),('DESPESAS ADMINISTRATIVAS','6.5',90),
      ('ADMINISTRATIVAS','6.5',85),('ADMINISTRATIVO','6.5',80),('DESPESAS COMERCIAIS','6.7',85),
      ('COMERCIAIS','6.7',75),('MARKETING','6.7',85),('DESPESAS FINANCEIRAS','8.2',90),
      ('RECEITAS FINANCEIRAS','8.1',90),('IMPOSTOS','3.4',80),('TRIBUTOS','3.4',80),
      ('SIMPLES','3.4',85),('IRPJ','10.1',95),('CSLL','10.2',95),
      ('INVESTIMENTOS EM IMOBILIZADO','9.1',90),('IMOBILIZADO','9.1',85),
      ('INVESTIMENTOS','9.1',75),('ATIVOS','9.1',70)
    ) AS m(keyword, psgc, conf)
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado, evidencia, rpc_que_gerou)
  SELECT DISTINCT ON (g.company_id, g.categoria)
    g.company_id, NULL, g.categoria, 'manual',
    COALESCE(g.sugestao_view, m.psgc), 'texto_livre_fuzzy',
    CASE WHEN g.sugestao_view IS NOT NULL THEN 85 WHEN m.psgc IS NOT NULL THEN m.conf ELSE 0 END,
    g.qtd_lancamentos, g.valor_total,
    jsonb_build_object('sugestao_outra_empresa', g.sugestao_view, 'keyword_matched', m.keyword,
      'estrategia', CASE WHEN g.sugestao_view IS NOT NULL THEN 'match_outra_empresa_psgestao' ELSE 'keyword_fuzzy_pt_br' END),
    'fn_sugerir_mapeamento_texto_livre'
  FROM gaps_texto g
  -- FIX: compara sem acento dos dois lados (antes: UPPER(g.categoria) LIKE '%'||m.keyword||'%')
  LEFT JOIN mapa_texto m ON fn_remove_acentos(g.categoria) LIKE '%' || fn_remove_acentos(m.keyword) || '%'
  WHERE COALESCE(g.sugestao_view, m.psgc) IS NOT NULL
  ORDER BY g.company_id, g.categoria, m.conf DESC NULLS LAST;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;
  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes WHERE estrategia='texto_livre_fuzzy' AND confianca_calculada >= 85;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes WHERE estrategia='texto_livre_fuzzy' AND confianca_calculada BETWEEN 70 AND 84;
  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $function$;

-- (C) fn_parsear_siga_path: comparar área e subárea sem acento dos dois lados
CREATE OR REPLACE FUNCTION public.fn_parsear_siga_path()
 RETURNS TABLE(qtd_sugestoes_geradas integer, qtd_alta_confianca integer, qtd_media_confianca integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_qtd_total INT := 0; v_qtd_alta INT := 0; v_qtd_media INT := 0;
BEGIN
  DELETE FROM psgc_depara_sugestoes WHERE estrategia = 'siga_path' AND status = 'pendente';

  WITH gaps_siga AS (
    SELECT v.company_id, v.empresa, v.categoria AS path_completo,
           TRIM(SPLIT_PART(v.categoria, '>', 1)) AS area_principal,
           TRIM(SPLIT_PART(v.categoria, '>', 2)) AS subarea,
           v.qtd_lancamentos, v.valor_total
    FROM v_categorias_sem_depara v
    WHERE v.status_mapeamento = 'sem_depara' AND v.sistema_origem = 'siga' AND v.categoria LIKE '%>%'
  ),
  mapa_siga AS (
    SELECT * FROM (VALUES
      ('CREDITO/RECEITAS OPERACIONAIS','1.1',90,'Receita bruta'),
      ('RECEITAS OPERACIONAIS','1.1',85,'Receita bruta'),
      ('CREDITOS','1.4',70,'Outras receitas'),
      ('RECEITAS NAO OPERACIONAIS','9.2',85,'Nao-operacionais'),
      ('DESPESAS OPERACIONAIS','6.5',80,'Operacionais'),
      ('DESPESAS ADMINISTRATIVAS','6.5',85,'Administrativas'),
      ('DESPESAS COMERCIAIS','6.7',85,'Vendas/marketing'),
      ('DESPESAS COM VENDAS','6.7',85,'Vendas/marketing'),
      ('DESPESAS DE VIAGENS','6.5',75,'Viagens'),
      ('DESPESAS FOLHA DE PAGAMENTO','6.1',90,'Folha pagamento'),
      ('FOLHA DE PAGAMENTO','6.1',90,'Folha pagamento'),
      ('PRO-LABORE','6.2',90,'Pro-labore'),('PROLABORE','6.2',90,'Pro-labore'),
      ('IMPOSTOS/TAXAS','3.4',85,'Impostos'),('IMPOSTOS','3.4',80,'Impostos'),
      ('TAXAS','6.5',70,'Taxas adm'),('CUSTO DAS VENDAS','4.1',90,'CMV'),
      ('CUSTO DOS PRODUTOS VENDIDOS','4.1',90,'CMV'),('CMV','4.1',95,'CMV'),
      ('MAO DE OBRA','4.3',85,'Mao obra'),('FRETE','4.5',80,'Frete'),
      ('DESPESAS FINANCEIRAS','8.2',90,'Financeiras'),('RECEITAS FINANCEIRAS','8.1',90,'Receitas fin'),
      ('JUROS','8.2',85,'Juros'),('TARIFAS BANCARIAS','8.2',90,'Tarifas'),
      ('CONSORCIOS','8.3',85,'Consorcios'),('COMISSOES','5.1',90,'Comissoes'),
      ('TRANSFERENCIAS','0.1',85,'Transferencias'),('ADIANTAMENTOS','0.2',85,'Adiantamentos'),
      ('DESPESAS ARTES GRAFICAS','6.7',85,'Artes graficas'),('ARTES GRAFICAS','6.7',80,'Artes graficas'),
      ('DESPESAS FOTO/FILMAGEM/JINGLE','6.7',85,'Audiovisual'),('FOTO/FILMAGEM/JINGLE','6.7',80,'Audiovisual')
    ) AS m(area, psgc, conf, descricao)
  ),
  sugestoes_base AS (
    SELECT g.company_id, g.path_completo, g.area_principal, g.subarea,
      g.qtd_lancamentos, g.valor_total, m.psgc AS psgc_area, m.conf AS conf_area, m.descricao AS descricao_area,
      -- FIX: subárea sem acento (antes: UPPER(g.subarea) ~ '(...|EMPRÉSTIMO|...)')
      CASE WHEN fn_remove_acentos(g.subarea) ~ '(pronamp|financiamento|emprestimo|giro|financing|loan)' THEN '8.2' ELSE m.psgc END AS psgc_final,
      CASE WHEN fn_remove_acentos(g.subarea) ~ '(pronamp|financiamento|emprestimo|giro|financing|loan)' THEN 90 ELSE m.conf END AS conf_final,
      CASE WHEN fn_remove_acentos(g.subarea) ~ '(pronamp|financiamento|emprestimo|giro|financing|loan)' THEN 'override_financiamento_subarea' ELSE 'mapa_area_principal' END AS metodo
    FROM gaps_siga g
    -- FIX: área sem acento dos dois lados (antes: UPPER(g.area_principal) = m.area)
    JOIN mapa_siga m ON fn_remove_acentos(g.area_principal) = fn_remove_acentos(m.area)
  )
  INSERT INTO psgc_depara_sugestoes (
    company_id, origem_codigo, origem_descricao, origem_sistema,
    psgc_codigo_sugerido, estrategia, confianca_calculada,
    qtd_lancamentos_afetados, valor_total_afetado, evidencia, rpc_que_gerou)
  SELECT s.company_id, NULL, s.path_completo, 'siga', s.psgc_final, 'siga_path',
    s.conf_final, s.qtd_lancamentos, s.valor_total,
    jsonb_build_object('area_parseada', s.area_principal, 'subarea_parseada', s.subarea,
      'mapa_aplicado', s.descricao_area, 'psgc_area', s.psgc_area, 'psgc_final', s.psgc_final,
      'metodo', s.metodo, 'fix_pronamp_aplicado', (s.metodo = 'override_financiamento_subarea')),
    'fn_parsear_siga_path'
  FROM sugestoes_base s;

  GET DIAGNOSTICS v_qtd_total = ROW_COUNT;
  SELECT COUNT(*) INTO v_qtd_alta FROM psgc_depara_sugestoes WHERE estrategia='siga_path' AND confianca_calculada >= 85;
  SELECT COUNT(*) INTO v_qtd_media FROM psgc_depara_sugestoes WHERE estrategia='siga_path' AND confianca_calculada BETWEEN 70 AND 84;
  RETURN QUERY SELECT v_qtd_total, v_qtd_alta, v_qtd_media;
END $function$;
