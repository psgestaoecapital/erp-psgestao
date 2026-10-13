-- ============================================================
-- fn_psgc_dre_horizontal_dia — DRE de 1 mês com DIAS nas colunas (opção 🅰️).
-- Mesmo esqueleto do fn_psgc_dre_horizontal (grupos → contas → linhas de
-- resultado, com os sinais já aplicados), mas por DIA e agregado do RAW
-- (erp_receber/erp_pagar) via psgc_depara — a mesma lógica do fn_psgc_dre_diario
-- (#813), agregando por CONTA×dia em vez de pessoa×dia. Assim a soma dos dias de
-- uma conta = o total do mês da conta (RD-38, fecha).
--
-- Regime (lição #813): competência = data_emissao (o campo do engine) / caixa =
-- data_pagamento. Higiene: só o mês pedido, ano >= 2024. Pilar 2: SECURITY
-- DEFINER + guard de escopo.
--
-- Retorno jsonb:
--   { ok, regime, empresas, ano, mes, dias_no_mes,
--     dias:   [{ d:1, ymd:'2026-03-01' }, ...],
--     linhas: [{ ordem, kind:'grupo'|'conta'|'resultado', codigo, nome, grupo_ref,
--                sinal, nivel, colapsavel, afeta_*, valores_dia:{ymd:<signed>} }] }
-- Aplicada via MCP em 2026-07-30.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal_dia(
  p_company_ids uuid[], p_ano int, p_mes int, p_regime text DEFAULT 'competencia'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := make_date(p_ano, p_mes, 1);
  v_fim      date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_empresas int  := 0;
  v_dias     jsonb;
  v_linhas   jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF p_ano < 2024 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Período anterior a 2024 não disponível');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT jsonb_agg(jsonb_build_object('d', d, 'ymd', to_char(make_date(p_ano,p_mes,d),'YYYY-MM-DD')) ORDER BY d)
    INTO v_dias
  FROM generate_series(1, extract(day FROM v_fim)::int) d;

  WITH raw AS (
    -- Receita ← erp_receber. Sem match no de-para → fallback '1.4' (mesmo do engine
    -- OMIE: COALESCE(pd.psgc_codigo,'1.4')). LEFT JOIN pra NÃO descartar o título.
    SELECT COALESCE(best.psgc_codigo, '1.4') AS psgc_codigo,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
           COALESCE(r.valor,0) AS valor,
           r.company_id
    FROM erp_receber r
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE r.company_id = ANY(p_company_ids)
      AND (r.status IS NULL OR r.status <> 'cancelado')
      AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim
    UNION ALL
    -- Despesa COMPETÊNCIA ← v_psgc_pagar_distribuido (a MESMA fonte do engine no
    -- regime competência p/ OMIE: valor_distribuido por data_emissao). Reconcilia
    -- o mês (o raw erp_pagar sobre-contava transfer/investimento). Fallback '6.11'.
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo,
           v.data_emissao AS dia,
           COALESCE(v.valor_distribuido,0) AS valor,
           v.company_id
    FROM v_psgc_pagar_distribuido v
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = v.company_id AND pd.origem_codigo = v.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE v_regime = 'competencia' AND v.company_id = ANY(p_company_ids)
      AND (v.status IS NULL OR v.status NOT IN ('cancelado','CANCELADO'))
      AND v.data_emissao BETWEEN v_ini AND v_fim
    UNION ALL
    -- Despesa CAIXA ← erp_pagar direto por data_pagamento (path do engine em caixa).
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo,
           p.data_pagamento::date AS dia,
           COALESCE(p.valor,0) AS valor,
           p.company_id
    FROM erp_pagar p
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE v_regime = 'caixa' AND p.company_id = ANY(p_company_ids)
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND p.data_pagamento::date BETWEEN v_ini AND v_fim
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
  conta_dia AS (
    SELECT r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD') AS ymd, SUM(r.valor) AS v
    FROM raw r JOIN psgc_contas c ON c.codigo = r.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO'
    GROUP BY r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD')
  ),
  grp_dia AS (SELECT dre_grupo, ymd, SUM(v) AS v FROM conta_dia GROUP BY dre_grupo, ymd),
  pivot AS (
    SELECT ymd,
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
    FROM grp_dia GROUP BY ymd
  ),
  res AS (
    SELECT ymd,
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
    (3000,'RL', '= Receita Líquida'), (4000,'MB', '= Margem Bruta'),
    (5000,'MC', '= Margem de Contribuição'), (6000,'EBITDA','= EBITDA'),
    (7000,'EBIT','= EBIT (Resultado Operacional)'), (8000,'RAI','= Resultado antes do IR/CSLL'),
    (9000,'LL', '= Lucro Líquido')
  ),
  linhas AS (
    SELECT gm.header_ordem::numeric AS ordem, 'grupo' AS kind, gm.dre_grupo AS codigo, gm.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 0 AS nivel, true AS colapsavel,
           NULL::boolean AS mb, NULL::boolean AS mc, NULL::boolean AS eb,
           jsonb_object_agg(g.ymd, round(gm.signo * g.v, 2)) AS valores_dia
    FROM gmap gm JOIN grp_dia g ON g.dre_grupo = gm.dre_grupo
    GROUP BY gm.header_ordem, gm.dre_grupo, gm.nome, gm.sinal
    UNION ALL
    SELECT (gm.header_ordem + c.dre_ordem * 0.001)::numeric AS ordem, 'conta' AS kind, c.codigo, c.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 1 AS nivel, false AS colapsavel,
           c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda,
           jsonb_object_agg(cd.ymd, round(gm.signo * cd.v, 2)) AS valores_dia
    FROM conta_dia cd
    JOIN psgc_contas c ON c.codigo = cd.psgc_codigo
    JOIN gmap gm ON gm.dre_grupo = c.dre_grupo
    GROUP BY c.codigo, c.nome, c.dre_ordem, gm.header_ordem, gm.dre_grupo, gm.sinal,
             c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda
    UNION ALL
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ymd, round(
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
           'valores_dia', valores_dia
         )) ORDER BY ordem)
    INTO v_linhas
  FROM linhas;

  SELECT count(DISTINCT company_id) INTO v_empresas FROM (
    SELECT company_id FROM erp_receber WHERE company_id = ANY(p_company_ids)
      AND (CASE WHEN v_regime='caixa' THEN data_pagamento::date ELSE data_emissao::date END) BETWEEN v_ini AND v_fim
    UNION
    SELECT company_id FROM erp_pagar WHERE company_id = ANY(p_company_ids)
      AND (CASE WHEN v_regime='caixa' THEN data_pagamento::date ELSE data_emissao::date END) BETWEEN v_ini AND v_fim
  ) e;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'empresas', v_empresas,
    'ano', p_ano, 'mes', p_mes, 'dias_no_mes', extract(day FROM v_fim)::int,
    'dias', COALESCE(v_dias, '[]'::jsonb),
    'linhas', COALESCE(v_linhas, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_horizontal_dia(uuid[], int, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_horizontal_dia(uuid[], int, int, text) TO authenticated;
