-- ============================================================
-- DRE HORIZONTAL CONSOLIDADO (Grupo) — F1 · RPC
-- Monta o DRE gerencial com MESES nas colunas (valores_mes jsonb), consolidando
-- N empresas (p_company_ids). Reusa psgc_dre + psgc_contas e ESPELHA a aritmética
-- de fn_psgc_dre_consolidada (RD-26) — mesmos sinais/subtotais, só que por mês e
-- com as contas-folha detalhadas + linhas de resultado (RL→MB→MC→EBITDA→EBIT→
-- RAI→Lucro Líquido).
--
-- Higiene: filtra ano < 2024 (outlier 2007 e ruído). Meses futuros = projeção
-- legítima (títulos c/ vencimento futuro) — mantidos e marcados (projecao=true
-- p/ mês > mês corrente).
--
-- Pilar 2: SECURITY DEFINER + guard de escopo (TODAS as company_ids têm de ser
-- acessíveis: is_admin OU todas em get_user_company_ids). Sem acesso → ok:false.
--
-- Retorno jsonb:
--   { ok, regime, empresas, mes_ini, mes_fim,
--     meses:  [{ ym:'2026-01', ano, mes, label:'jan/26', projecao:bool }, ...],
--     linhas: [{ ordem, kind:'grupo'|'conta'|'resultado', codigo, nome,
--                grupo_ref, sinal:'+'|'-'|'±'|'=', nivel, colapsavel,
--                afeta_margem_bruta/contribuicao/ebitda (conta),
--                valores_mes:{ '2026-01': <signed numeric>, ... } }, ...] }
-- Sinal já aplicado em valores_mes: ROB (+); DEDUCOES/IMPOSTOS/CMV/DESP_*/DEPREC/
-- RESULT_FIN/NAO_OPER/IR_CSLL (−). Assim cada coluna soma coerente pro resultado.
-- Aplicada via MCP em 2026-07-30 — versionada aqui pra cristalizar drift.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal(
  p_company_ids uuid[],
  p_mes_ini date,
  p_mes_fim date,
  p_regime text DEFAULT 'competencia'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := date_trunc('month', p_mes_ini)::date;
  v_fim      date := date_trunc('month', p_mes_fim)::date;
  v_cur      date := date_trunc('month', now())::date;
  v_empresas int  := 0;
  v_meses    jsonb;
  v_linhas   jsonb;
BEGIN
  -- guard de escopo: nenhuma empresa pedida pode estar fora do acesso do usuário
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id)
    WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  -- eixo dos meses (rótulo pt-BR determinístico; projeção = mês futuro)
  SELECT jsonb_agg(jsonb_build_object(
           'ym', to_char(m,'YYYY-MM'),
           'ano', extract(year from m)::int,
           'mes', extract(month from m)::int,
           'label', (ARRAY['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from m)::int]
                    || '/' || to_char(m,'YY'),
           'projecao', (m > v_cur)
         ) ORDER BY m)
    INTO v_meses
  FROM generate_series(v_ini, v_fim, interval '1 month') g(m);

  SELECT count(DISTINCT d.company_id) INTO v_empresas
  FROM psgc_dre d
  WHERE d.company_id = ANY(p_company_ids)
    AND COALESCE(d.regime,'competencia') = v_regime
    AND d.ano >= 2024
    AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND v_fim;

  WITH base AS (   -- soma por conta × mês, consolidando as empresas
    SELECT d.psgc_codigo,
           to_char(make_date(d.ano,d.mes,1),'YYYY-MM') AS ym,
           SUM(d.valor) AS valor
    FROM psgc_dre d
    WHERE d.company_id = ANY(p_company_ids)
      AND COALESCE(d.regime,'competencia') = v_regime
      AND d.ano >= 2024
      AND make_date(d.ano,d.mes,1) BETWEEN v_ini AND v_fim
    GROUP BY d.psgc_codigo, to_char(make_date(d.ano,d.mes,1),'YYYY-MM')
  ),
  gmap(dre_grupo, header_ordem, sinal, nome, signo) AS (VALUES
    ('ROB',            1000, '+', 'Receita Operacional Bruta',        1),
    ('DEDUCOES',       2000, '-', '(−) Deduções',                    -1),
    ('IMPOSTOS_VENDA', 2100, '-', '(−) Impostos sobre Vendas',       -1),
    ('CMV',            3100, '-', '(−) CMV / CPV / CSP',             -1),
    ('DESP_VARIAVEL',  4100, '-', '(−) Despesas Variáveis',          -1),
    ('DESP_FIXA',      5100, '-', '(−) Despesas Fixas',              -1),
    ('DEPREC_AMORT',   6100, '-', '(−) Depreciação e Amortização',   -1),
    ('RESULT_FIN',     7100, '±', '(±) Resultado Financeiro',        -1),
    ('NAO_OPER',       7200, '±', '(±) Resultado Não-Operacional',   -1),
    ('IR_CSLL',        8100, '-', '(−) IR e CSLL',                   -1)
  ),
  grp_mes AS (     -- total por grupo × mês (base dos headers e dos resultados)
    SELECT c.dre_grupo, b.ym, SUM(b.valor) AS v
    FROM base b JOIN psgc_contas c ON c.codigo = b.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO'
    GROUP BY c.dre_grupo, b.ym
  ),
  pivot AS (       -- pivô por mês p/ as linhas de resultado
    SELECT g.ym,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='ROB'),0)            AS rob,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEDUCOES'),0)       AS deducoes,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IMPOSTOS_VENDA'),0) AS impostos,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='CMV'),0)            AS cmv,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_VARIAVEL'),0)  AS desp_var,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_FIXA'),0)      AS desp_fixa,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEPREC_AMORT'),0)   AS deprec,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='RESULT_FIN'),0)     AS result_fin,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='NAO_OPER'),0)       AS nao_oper,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0)        AS ir_csll
    FROM grp_mes g GROUP BY g.ym
  ),
  res AS (         -- resultado por mês (mesma aritmética da consolidada)
    SELECT ym, rob, deducoes, impostos, cmv, desp_var, desp_fixa, deprec, result_fin, nao_oper, ir_csll,
      (rob - deducoes - impostos)                                              AS rl,
      (rob - deducoes - impostos - cmv)                                        AS mb,
      (rob - deducoes - impostos - cmv - desp_var)                             AS mc,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa)                 AS ebitda,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec)        AS ebit,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper) AS rai,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll) AS ll
    FROM pivot
  ),
  res_lines(ordem, codigo, nome) AS (VALUES
    (3000,'RL', '= Receita Líquida'),
    (4000,'MB', '= Margem Bruta'),
    (5000,'MC', '= Margem de Contribuição'),
    (6000,'EBITDA','= EBITDA'),
    (7000,'EBIT','= EBIT (Resultado Operacional)'),
    (8000,'RAI','= Resultado antes do IR/CSLL'),
    (9000,'LL', '= Lucro Líquido')
  ),
  linhas AS (
    -- headers de grupo (só grupos com dado no período)
    SELECT gm.header_ordem::numeric AS ordem, 'grupo' AS kind, gm.dre_grupo AS codigo, gm.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 0 AS nivel, true AS colapsavel,
           NULL::boolean AS mb, NULL::boolean AS mc, NULL::boolean AS eb,
           jsonb_object_agg(g.ym, round(gm.signo * g.v, 2)) AS valores_mes
    FROM gmap gm JOIN grp_mes g ON g.dre_grupo = gm.dre_grupo
    GROUP BY gm.header_ordem, gm.dre_grupo, gm.nome, gm.sinal

    UNION ALL
    -- contas-folha (detalhe colapsável sob o grupo)
    SELECT (gm.header_ordem + c.dre_ordem * 0.001)::numeric AS ordem, 'conta' AS kind, c.codigo, c.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 1 AS nivel, false AS colapsavel,
           c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda,
           jsonb_object_agg(cm.ym, round(gm.signo * cm.v, 2)) AS valores_mes
    FROM (SELECT b.psgc_codigo, b.ym, SUM(b.valor) AS v FROM base b GROUP BY b.psgc_codigo, b.ym) cm
    JOIN psgc_contas c ON c.codigo = cm.psgc_codigo
    JOIN gmap gm ON gm.dre_grupo = c.dre_grupo
    GROUP BY c.codigo, c.nome, c.dre_ordem, gm.header_ordem, gm.dre_grupo, gm.sinal,
             c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda

    UNION ALL
    -- linhas de resultado (subtotais calculados)
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ym, round(
             CASE rl.codigo WHEN 'RL' THEN r.rl WHEN 'MB' THEN r.mb WHEN 'MC' THEN r.mc
               WHEN 'EBITDA' THEN r.ebitda WHEN 'EBIT' THEN r.ebit WHEN 'RAI' THEN r.rai
               WHEN 'LL' THEN r.ll END, 2))
    FROM res_lines rl CROSS JOIN res r
    GROUP BY rl.ordem, rl.codigo, rl.nome
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ordem', ordem, 'kind', kind, 'codigo', codigo, 'nome', nome,
           'grupo_ref', grupo_ref, 'sinal', sinal, 'nivel', nivel, 'colapsavel', colapsavel,
           'afeta_margem_bruta', mb, 'afeta_margem_contribuicao', mc, 'afeta_ebitda', eb,
           'valores_mes', valores_mes
         )) ORDER BY ordem)
    INTO v_linhas
  FROM linhas;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'empresas', v_empresas,
    'mes_ini', v_ini, 'mes_fim', v_fim,
    'meses', COALESCE(v_meses, '[]'::jsonb),
    'linhas', COALESCE(v_linhas, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_horizontal(uuid[], date, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_horizontal(uuid[], date, date, text) TO authenticated;
