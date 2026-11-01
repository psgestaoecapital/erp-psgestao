-- DRE Consolidado ABERTO POR LINHA DE NEGÓCIO (CEO 14/10, reunião com cliente).
-- Mesma árvore do DRE Consolidado (fn_psgc_dre_horizontal), mas com as COLUNAS = linhas de negócio
-- (em vez de meses), para o período escolhido. Cada linha do DRE mostra o valor por linha de negócio.
--
-- NÃO DUPLICA CÁLCULO (RD do CEO): lê o MESMO fato já calculado pelo motor do DRE (public.psgc_dre, que já
-- grava ln_id/ln_nome por lançamento) e os MESMOS rótulos/sinais/grupos (public.psgc_contas). A despesa/receita
-- SEM linha de negócio (ln_id NULL no psgc_dre) NÃO some: vira a coluna "Comum / não alocado" (um zero mente; um
-- bucket informa). O "depois do rateio" (EBITDA real por linha) vem da MESMA base do DRE Divisional
-- (public.v_dre_divisional_completo, rateio NBC TG 16 já calculado) — aqui só é LIDA, nunca recalculada.
--
-- Chave da coluna = ln_nome (consolida linhas de mesmo nome entre os CNPJs do grupo); ln_id NULL => '__comum__'.
-- Só leitura, SECURITY DEFINER, MESMA guarda das fn_psgc_dre_* (is_admin OU todas as empresas do usuário),
-- REVOKE anon. Aditiva (função NOVA, não altera nenhuma função/visão do núcleo).

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal_por_ln(
  p_company_ids uuid[],
  p_mes_ini date,
  p_mes_fim date,
  p_regime text DEFAULT 'competencia'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := date_trunc('month', p_mes_ini)::date;
  v_fim      date := date_trunc('month', p_mes_fim)::date;
  v_empresas int  := 0;
  v_colunas  jsonb;
  v_linhas   jsonb;
  v_rateio   jsonb := NULL;
  v_tem_rateio boolean := false;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id)
    WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT count(DISTINCT d.company_id) INTO v_empresas
  FROM psgc_dre d
  WHERE d.company_id = ANY(p_company_ids)
    AND COALESCE(d.regime,'competencia') = v_regime
    AND d.ano >= 2024
    AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND v_fim;

  -- Fato por conta × linha de negócio (coluna). Mesmo flip de sinal do consolidado:
  -- um "receber" em conta não-operacional/financeira entra negativo.
  WITH base AS (
    SELECT d.psgc_codigo,
           COALESCE(NULLIF(btrim(d.ln_nome),''), '__comum__') AS ln_key,
           SUM(CASE WHEN d.source ILIKE '%receber%' AND pcx.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -d.valor ELSE d.valor END) AS valor
    FROM psgc_dre d
    LEFT JOIN psgc_contas pcx ON pcx.codigo = d.psgc_codigo
    WHERE d.company_id = ANY(p_company_ids)
      AND COALESCE(d.regime,'competencia') = v_regime
      AND d.ano >= 2024
      AND make_date(d.ano,d.mes,1) BETWEEN v_ini AND v_fim
    GROUP BY d.psgc_codigo, COALESCE(NULLIF(btrim(d.ln_nome),''), '__comum__')
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
    ('IR_CSLL',        8100, '-', '(−) IR e CSLL',                   -1),
    ('DESTINACAO',     9500, '-', 'Destinação do Lucro',            -1)
  ),
  grp_ln AS (
    SELECT c.dre_grupo, b.ln_key, SUM(b.valor) AS v
    FROM base b JOIN psgc_contas c ON c.codigo = b.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO'
    GROUP BY c.dre_grupo, b.ln_key
  ),
  pivot AS (
    SELECT g.ln_key,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='ROB'),0)            AS rob,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEDUCOES'),0)       AS deducoes,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IMPOSTOS_VENDA'),0) AS impostos,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='CMV'),0)            AS cmv,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_VARIAVEL'),0)  AS desp_var,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_FIXA'),0)      AS desp_fixa,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEPREC_AMORT'),0)   AS deprec,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='RESULT_FIN'),0)     AS result_fin,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='NAO_OPER'),0)       AS nao_oper,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0)        AS ir_csll,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESTINACAO'),0)     AS destinacao
    FROM grp_ln g GROUP BY g.ln_key
  ),
  res AS (
    SELECT ln_key, rob, deducoes, impostos, cmv, desp_var, desp_fixa, deprec, result_fin, nao_oper, ir_csll, destinacao,
      (rob - deducoes - impostos)                                              AS rl,
      (rob - deducoes - impostos - cmv)                                        AS mb,
      (rob - deducoes - impostos - cmv - desp_var)                             AS mc,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa)                 AS ebitda,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec)        AS ebit,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper) AS rai,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll) AS ll,
      (rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll - destinacao) AS lrt
    FROM pivot
  ),
  res_lines(ordem, codigo, nome) AS (VALUES
    (3000,'RL', '= Receita Líquida'),
    (4000,'MB', '= Margem Bruta'),
    (5000,'MC', '= Margem de Contribuição'),
    (6000,'EBITDA','= EBITDA'),
    (7000,'EBIT','= EBIT (Resultado Operacional)'),
    (8000,'RAI','= Resultado antes do IR/CSLL'),
    (9000,'LL', '= Lucro Líquido'),
    (9900,'LRT','= Lucro Líquido Retido')
  ),
  linhas AS (
    SELECT gm.header_ordem::numeric AS ordem, 'grupo' AS kind, gm.dre_grupo AS codigo, gm.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 0 AS nivel, true AS colapsavel,
           NULL::boolean AS mb, NULL::boolean AS mc, NULL::boolean AS eb,
           jsonb_object_agg(g.ln_key, round(gm.signo * g.v, 2)) AS valores
    FROM gmap gm JOIN grp_ln g ON g.dre_grupo = gm.dre_grupo
    GROUP BY gm.header_ordem, gm.dre_grupo, gm.nome, gm.sinal
    UNION ALL
    SELECT (gm.header_ordem + c.dre_ordem * 0.001)::numeric AS ordem, 'conta' AS kind, c.codigo, c.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 1 AS nivel, false AS colapsavel,
           c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda,
           jsonb_object_agg(cm.ln_key, round(gm.signo * cm.v, 2)) AS valores
    FROM (SELECT b.psgc_codigo, b.ln_key, SUM(b.valor) AS v FROM base b GROUP BY b.psgc_codigo, b.ln_key) cm
    JOIN psgc_contas c ON c.codigo = cm.psgc_codigo
    JOIN gmap gm ON gm.dre_grupo = c.dre_grupo
    GROUP BY c.codigo, c.nome, c.dre_ordem, gm.header_ordem, gm.dre_grupo, gm.sinal,
             c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda
    UNION ALL
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ln_key, round(
             CASE rl.codigo WHEN 'RL' THEN r.rl WHEN 'MB' THEN r.mb WHEN 'MC' THEN r.mc
               WHEN 'EBITDA' THEN r.ebitda WHEN 'EBIT' THEN r.ebit WHEN 'RAI' THEN r.rai
               WHEN 'LL' THEN r.ll WHEN 'LRT' THEN r.lrt END, 2))
    FROM res_lines rl CROSS JOIN res r
    GROUP BY rl.ordem, rl.codigo, rl.nome
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ordem', ordem, 'kind', kind, 'codigo', codigo, 'nome', nome,
           'grupo_ref', grupo_ref, 'sinal', sinal, 'nivel', nivel, 'colapsavel', colapsavel,
           'afeta_margem_bruta', mb, 'afeta_margem_contribuicao', mc, 'afeta_ebitda', eb,
           'valores', valores
         )) ORDER BY ordem)
    INTO v_linhas
  FROM linhas;

  -- Colunas = linhas de negócio presentes no fato. Reais ordenadas por ROB desc; "Comum / não alocado" por último.
  -- Query própria (CTE não atravessa statements): recomputa a partir do psgc_dre, mesma guarda de período/regime.
  SELECT jsonb_agg(jsonb_build_object(
           'key', ln_key,
           'nome', CASE WHEN ln_key='__comum__' THEN 'Comum / não alocado' ELSE ln_key END,
           'is_comum', (ln_key='__comum__')
         ) ORDER BY (ln_key='__comum__'), rob_col DESC, ln_key)
    INTO v_colunas
  FROM (
    SELECT COALESCE(NULLIF(btrim(d.ln_nome),''),'__comum__') AS ln_key,
           COALESCE(SUM(CASE WHEN c.dre_grupo='ROB' THEN d.valor ELSE 0 END),0) AS rob_col
    FROM psgc_dre d JOIN psgc_contas c ON c.codigo = d.psgc_codigo
    WHERE d.company_id = ANY(p_company_ids)
      AND COALESCE(d.regime,'competencia') = v_regime
      AND d.ano >= 2024
      AND make_date(d.ano,d.mes,1) BETWEEN v_ini AND v_fim
    GROUP BY COALESCE(NULLIF(btrim(d.ln_nome),''),'__comum__')
  ) cols;

  -- DEPOIS DO RATEIO (EBITDA real por linha) — MESMA base do DRE Divisional (NBC TG 16 já calculado na view).
  -- Só no regime competência (a view é de competência). Casa por ln_nome dentro do grupo, no intervalo de meses.
  IF v_regime = 'competencia' THEN
    SELECT jsonb_build_object(
             'tem_rateio', (count(*) > 0),
             'por_ln', COALESCE(jsonb_object_agg(ln_nome, jsonb_build_object(
                 'rob', round(rob,2),
                 'ebitda_pre_rateio', round(ebitda_pre,2),
                 'rateio_sede_recebido', round(rateio_sede,2),
                 'ebitda_pos_rateio', round(ebitda_pos,2),
                 'ebitda_pct_pos_rateio', CASE WHEN rob > 0 THEN round(ebitda_pos/rob*100,2) ELSE 0 END
               )) FILTER (WHERE ln_nome IS NOT NULL), '{}'::jsonb),
             'rateio_total', round(COALESCE(SUM(rateio_sede),0),2),
             'ebitda_pos_total', round(COALESCE(SUM(ebitda_pos),0),2)
           )
      INTO v_rateio
    FROM (
      SELECT v.ln_nome,
             SUM(v.rob) AS rob, SUM(v.ebitda_pre_rateio) AS ebitda_pre,
             SUM(v.rateio_sede_recebido) AS rateio_sede, SUM(v.ebitda_pos_rateio) AS ebitda_pos
      FROM v_dre_divisional_completo v
      WHERE v.company_id = ANY(p_company_ids)
        AND make_date(v.ano, v.mes, 1) BETWEEN v_ini AND v_fim
      GROUP BY v.ln_nome
    ) r;
    v_tem_rateio := COALESCE((v_rateio->>'tem_rateio')::boolean, false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'empresas', v_empresas,
    'mes_ini', v_ini, 'mes_fim', v_fim,
    'colunas', COALESCE(v_colunas, '[]'::jsonb),
    'linhas', COALESCE(v_linhas, '[]'::jsonb),
    'tem_rateio', v_tem_rateio,
    'rateio', v_rateio
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_horizontal_por_ln(uuid[], date, date, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_horizontal_por_ln(uuid[], date, date, text) TO authenticated, service_role;

-- RD-95: "?" nos novos campos/controles da visão "Por linha de negócio".
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
 ('financeiro.dre_consolidado.ln_visao', '/dashboard/financeiro/dre-consolidado', 'Linha de negócio',
  'Visão por linha de negócio',
  'Não se preenche: é um botão que troca as COLUNAS do DRE de meses para linhas de negócio (ex.: Gesso, Pintura, Piso).',
  'Mostra o resultado de cada linha de negócio lado a lado no período escolhido — para comparar quem dá lucro e quem não dá.',
  'Com Jan–Dez selecionado, a visão por linha mostra uma coluna por linha de negócio, não por mês.',
  'Esperar ver meses nesta visão: aqui as colunas são as linhas de negócio. Volte para "Consolidado" para ver por mês.',
  'financeiro', 20),
 ('financeiro.dre_consolidado.ln_seletor', '/dashboard/financeiro/dre-consolidado', 'Linha de negócio',
  'Linha de negócio',
  'Escolha "Todas" para comparar todas, ou uma linha específica para ver só o DRE dela.',
  'Filtra todo o DRE (e o detalhamento) para a linha escolhida — útil para analisar uma operação isolada.',
  'Escolher "Pintura" mostra só o DRE da Pintura; "Todas" mostra uma coluna por linha mais o Total.',
  'Achar que uma despesa sumiu: a despesa sem linha fica sempre na coluna "Comum / não alocado".',
  'financeiro', 21),
 ('financeiro.dre_consolidado.ln_comum', '/dashboard/financeiro/dre-consolidado', 'Linha de negócio',
  'Comum / não alocado',
  'Não se preenche: é a coluna dos lançamentos SEM linha de negócio (não classificados).',
  'A receita/despesa não classificada NUNCA some — fica aqui, e a soma das colunas fecha com o total do grupo.',
  'Um aluguel lançado sem linha de negócio aparece na coluna "Comum / não alocado".',
  'Ignorar o Comum alto: quanto mais aqui, menos confiável a comparação entre linhas — classifique os lançamentos.',
  'financeiro', 22),
 ('financeiro.dre_consolidado.ln_margem', '/dashboard/financeiro/dre-consolidado', 'Linha de negócio',
  'Margem da linha',
  'Não se preenche: é o EBITDA da linha dividido pela sua receita bruta, em %.',
  'Compara a eficiência de cada linha de negócio — margem alta rende mais por real vendido.',
  'Pintura com EBITDA R$ 30.000 sobre receita R$ 100.000 = margem de 30%.',
  'Comparar só o valor absoluto: uma linha grande pode ter margem pior que uma pequena. Olhe a margem (%).',
  'financeiro', 23),
 ('financeiro.dre_consolidado.ln_rateio', '/dashboard/financeiro/dre-consolidado', 'Linha de negócio',
  'EBITDA real (após rateio)',
  'Não se preenche: é o EBITDA de cada linha DEPOIS de absorver as despesas comuns (rateio NBC TG 16 do DRE Divisional).',
  'Mostra o resultado real de cada linha quando o custo comum (coluna "Comum / não alocado") é distribuído entre elas.',
  'Antes do rateio a Pintura tem R$ 30.000; após absorver parte do comum, o EBITDA real fica R$ 22.000.',
  'Confundir antes e depois: antes do rateio o comum fica numa coluna; depois é dividido entre as linhas pela receita.',
  'financeiro', 24)
ON CONFLICT (chave) DO NOTHING;
