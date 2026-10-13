-- ============================================================
-- DRE · "Distribuição de Resultado aos Sócios" vira DESTINAÇÃO DO LUCRO (abaixo do Lucro Líquido)
-- Pedido do CEO (#44): distribuição de lucros NÃO é despesa — não pode reduzir o resultado
-- operacional. "No motor do DRE, não nos lançamentos. Não altere a categoria dos R$200k gravados;
-- se mexer no dado, relatório antigo muda de número e ninguém entende. O DRE lê a conta e posiciona
-- abaixo do Lucro Líquido. Mesmo lançamento, apresentação certa."
--
-- COMO (apresentação, não dado):
--  1) A CONTA psgc 0.3 "Distribuição de Resultado aos Sócios" sai do balde NEUTRO (invisível) para um
--     grupo próprio de apresentação: 'DESTINACAO'. É reclassificação da CONTA (dicionário do motor),
--     NÃO do lançamento — o valor gravado em erp_pagar / psgc_dre.valor NÃO muda.
--  2) fn_psgc_recalcular_dre_mes roteia a distribuição para 0.3 via um LATERAL 'ndp' que casava só
--     dre_grupo='NEUTRO'. Como 0.3 passa a 'DESTINACAO', esse filtro vira IN ('NEUTRO','DESTINACAO')
--     para o roteamento continuar IDÊNTICO (o R$200k continua indo para 0.3, nunca para 6.11/despesa).
--  3) Os motores de exibição (horizontal, horizontal_dia, consolidada) ganham a seção
--     "Destinação do Lucro" ABAIXO do Lucro Líquido (excluída de todos os subtotais operacionais) e
--     uma linha de fecho "= Lucro Líquido Retido" (= LL − destinação). O Lucro Líquido (e RL/MB/MC/
--     EBITDA/EBIT/RAI) NÃO muda de número — 0.3 nunca somou nesses subtotais (era NEUTRO/excluído).
--  4) fn_psgc_dre_diario (drill-down por código) não precisa mudar: 0.3 continua sendo saída (natureza
--     não_operacional; dre_grupo 'DESTINACAO' não está em ROB/RECEITAS_NAO_OP), lista os sócios/pessoas.
--
-- Pró-Labore (6.2, DESP_FIXA) NÃO é tocado — é despesa operacional real, permanece acima da linha.
-- Transferências entre Contas (0.1, NEUTRO) permanecem invisíveis (não são destinação de lucro).
-- ============================================================

-- 1) Reclassificação da CONTA (motor do DRE), não do lançamento.
UPDATE public.psgc_contas
SET dre_grupo = 'DESTINACAO',
    dre_ordem = 10
WHERE codigo = '0.3';

-- 2) Roteamento no recálculo: mantém a distribuição indo para 0.3 (agora 'DESTINACAO'), nunca 6.11.
CREATE OR REPLACE FUNCTION public.fn_psgc_recalcular_dre_mes(p_company_id uuid, p_ano integer, p_mes integer)
 RETURNS TABLE(linhas_processadas bigint, valor_agregado numeric, contas_unicas bigint, lns_distintas bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_data_inicio date;
  v_data_fim date;
  v_tem_omie boolean;
  v_tem_lancamentos_no_mes boolean;
  v_tem_pagar_emissao boolean;
  v_tem_receber_emissao boolean;
  v_tem_pagar_caixa boolean;
  v_tem_receber_caixa boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND ambiente_tenant = 'producao') THEN
    RETURN;  -- [DEMO-F1 p3] tenant demo/sandbox nao entra na DRE
  END IF;

  v_data_inicio := make_date(p_ano, p_mes, 1);
  v_data_fim := (v_data_inicio + interval '1 month - 1 day')::date;

  v_tem_omie := EXISTS(
    SELECT 1 FROM company_data_sources cds
    JOIN data_sources ds ON ds.id=cds.data_source_id
    WHERE cds.company_id=p_company_id AND cds.ativo AND ds.slug ILIKE '%omie%'
  );

  v_tem_lancamentos_no_mes := EXISTS(
    SELECT 1 FROM erp_lancamentos
    WHERE company_id=p_company_id
      AND data_emissao IS NOT NULL
      AND fn_parse_data_text(data_emissao) BETWEEN v_data_inicio AND v_data_fim
    LIMIT 1
  );

  v_tem_pagar_emissao := EXISTS(
    SELECT 1 FROM erp_pagar
    WHERE company_id=p_company_id AND data_emissao IS NOT NULL
      AND data_emissao BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );
  v_tem_receber_emissao := EXISTS(
    SELECT 1 FROM erp_receber
    WHERE company_id=p_company_id AND data_emissao IS NOT NULL
      AND data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );

  v_tem_pagar_caixa := EXISTS(
    SELECT 1 FROM erp_pagar
    WHERE company_id=p_company_id AND data_pagamento IS NOT NULL
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );
  v_tem_receber_caixa := EXISTS(
    SELECT 1 FROM erp_receber
    WHERE company_id=p_company_id AND data_pagamento IS NOT NULL
      AND data_pagamento::date BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );

  DELETE FROM psgc_dre WHERE company_id = p_company_id AND ano = p_ano AND mes = p_mes;

  IF v_tem_omie THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, ln_id_val, ln_nome_val, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_omie', 'competencia'
    FROM (
      SELECT v.business_line_id as ln_id_val, bl.name as ln_nome_val,
        COALESCE(pd.psgc_codigo, '6.11') as codigo_psgc,
        v.valor_distribuido as v, 1 as q
      FROM v_psgc_pagar_distribuido v
      LEFT JOIN business_lines bl ON bl.id=v.business_line_id
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd
        JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
        WHERE pd.company_id=v.company_id AND pd.origem_codigo=v.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) pd ON true
      WHERE v.company_id=p_company_id AND v.data_emissao BETWEEN v_data_inicio AND v_data_fim
        AND (v.status IS NULL OR v.status NOT IN ('CANCELADO','cancelado'))
    ) sub GROUP BY ln_id_val, ln_nome_val, codigo_psgc
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();

    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, ln_id_val, ln_nome_val, codigo_psgc, SUM(v), SUM(q), 'etl_receber', 'competencia'
    FROM (
      SELECT cln.ln_id as ln_id_val, cln.ln_nome as ln_nome_val,
        COALESCE(pd.psgc_codigo, '1.4') as codigo_psgc,
        COALESCE(r.valor, 0) as v, 1 as q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd
        JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
        WHERE pd.company_id=r.company_id AND pd.origem_codigo=r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) pd ON true
      LEFT JOIN LATERAL fn_psgc_classificar_ln(r.company_id, COALESCE((SELECT descricao FROM erp_plano_contas WHERE company_id=r.company_id AND codigo=r.categoria LIMIT 1), r.categoria, r.descricao, '')) cln ON true
      WHERE r.company_id=p_company_id AND r.data_emissao IS NOT NULL
        AND r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status != 'cancelado')
    ) sub GROUP BY ln_id_val, ln_nome_val, codigo_psgc
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();

  ELSIF v_tem_lancamentos_no_mes THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, ln_id_val, ln_nome_val, codigo_psgc, SUM(v), SUM(q), 'etl_lancamento', 'competencia'
    FROM (
      SELECT
        COALESCE(l.business_line_id, cln.ln_id) as ln_id_val,
        COALESCE((SELECT name FROM business_lines WHERE id=l.business_line_id), cln.ln_nome) as ln_nome_val,
        CASE
          WHEN LOWER(l.tipo) IN ('receita','receber') THEN
            COALESCE(
              (SELECT pd.psgc_codigo FROM psgc_depara pd
               JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
               WHERE pd.company_id=l.company_id AND pd.origem_codigo IN (l.plano_conta_codigo, l.categoria) AND pd.ativo
                 AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
               ORDER BY pd.confianca DESC, pd.revisado DESC, (pd.origem_codigo=l.plano_conta_codigo) DESC LIMIT 1),
              fn_classificar_categoria_siga_tipo(l.categoria, 'receber'),
              '1.4'
            )
          ELSE
            COALESCE(
              (SELECT pd.psgc_codigo FROM psgc_depara pd
               JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
               WHERE pd.company_id=l.company_id AND pd.origem_codigo IN (l.plano_conta_codigo, l.categoria) AND pd.ativo
                 AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
               ORDER BY pd.confianca DESC, pd.revisado DESC, (pd.origem_codigo=l.plano_conta_codigo) DESC LIMIT 1),
              fn_classificar_categoria_siga_tipo(l.categoria, 'pagar'),
              '6.11'
            )
        END as codigo_psgc,
        ABS(COALESCE(l.valor_documento, 0)) as v, 1 as q
      FROM erp_lancamentos l
      LEFT JOIN LATERAL fn_psgc_classificar_ln(l.company_id, COALESCE(l.descricao, l.categoria, l.subcategoria, '')) cln ON true
      WHERE l.company_id=p_company_id
        AND l.data_emissao IS NOT NULL
        AND fn_parse_data_text(l.data_emissao) BETWEEN v_data_inicio AND v_data_fim
        AND (l.status IS NULL OR l.status != 'cancelado')
    ) sub GROUP BY ln_id_val, ln_nome_val, codigo_psgc
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_pagar_emissao AND NOT v_tem_lancamentos_no_mes AND NOT v_tem_omie THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_direto', 'competencia'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,  -- FIX: de-para NEUTRO/DESTINACAO (ex.: distribuição 0.3) tem prioridade — sai do resultado operacional
          CASE
            WHEN epc.tipo = 'investimento'
            THEN COALESCE(dp.psgc_codigo, '9.3')
            ELSE '6.11'
          END
        ) AS codigo_psgc,
        p.valor AS v, 1 AS q
      FROM erp_pagar p
      LEFT JOIN erp_plano_contas epc
        ON epc.company_id = p.company_id AND epc.codigo = p.categoria
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo
        FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo = 'NAO_OPER'
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo
        FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo IN ('NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) ndp ON true
      WHERE p.company_id = p_company_id AND p.data_emissao IS NOT NULL
        AND p.data_emissao BETWEEN v_data_inicio AND v_data_fim AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_receber_emissao AND NOT v_tem_lancamentos_no_mes AND NOT v_tem_omie THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           '1.4', SUM(r.valor), COUNT(*), 'etl_receber_direto', 'competencia'
    FROM erp_receber r WHERE r.company_id=p_company_id AND r.data_emissao IS NOT NULL
      AND r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
      AND (r.status IS NULL OR r.status != 'cancelado')
    HAVING COUNT(*)>0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_pagar_caixa THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_caixa', 'caixa'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,  -- FIX: de-para NEUTRO/DESTINACAO (ex.: distribuição 0.3) tem prioridade — sai do resultado operacional
          CASE
            WHEN epc.tipo = 'investimento'
            THEN COALESCE(dp.psgc_codigo, '9.3')
            ELSE '6.11'
          END
        ) AS codigo_psgc,
        p.valor AS v, 1 AS q
      FROM erp_pagar p
      LEFT JOIN erp_plano_contas epc
        ON epc.company_id = p.company_id AND epc.codigo = p.categoria
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo
        FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo = 'NAO_OPER'
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo
        FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo IN ('NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) ndp ON true
      WHERE p.company_id = p_company_id AND p.data_pagamento IS NOT NULL
        AND p.data_pagamento BETWEEN v_data_inicio AND v_data_fim AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_receber_caixa THEN
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           '1.4', SUM(r.valor), COUNT(*), 'etl_receber_caixa', 'caixa'
    FROM erp_receber r WHERE r.company_id=p_company_id AND r.data_pagamento IS NOT NULL
      AND r.data_pagamento::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
      AND (r.status IS NULL OR r.status != 'cancelado')
    HAVING COUNT(*)>0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  RETURN QUERY
  SELECT SUM(d.qtd_lancamentos)::bigint, SUM(d.valor)::numeric, COUNT(DISTINCT d.psgc_codigo)::bigint, COUNT(DISTINCT d.ln_id)::bigint
  FROM psgc_dre d WHERE d.company_id=p_company_id AND d.ano=p_ano AND d.mes=p_mes;
END;
$function$;

-- 3) DRE horizontal (colunas = meses): seção "Destinação do Lucro" abaixo do Lucro Líquido.
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal(p_company_ids uuid[], p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := date_trunc('month', p_mes_ini)::date;
  v_fim      date := date_trunc('month', p_mes_fim)::date;
  v_cur      date := date_trunc('month', now())::date;
  v_empresas int  := 0;
  v_meses    jsonb;
  v_linhas   jsonb;
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

  WITH base AS (
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
    ('IR_CSLL',        8100, '-', '(−) IR e CSLL',                   -1),
    ('DESTINACAO',     9500, '-', 'Destinação do Lucro',            -1)
  ),
  grp_mes AS (
    SELECT c.dre_grupo, b.ym, SUM(b.valor) AS v
    FROM base b JOIN psgc_contas c ON c.codigo = b.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO'
    GROUP BY c.dre_grupo, b.ym
  ),
  pivot AS (
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
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0)        AS ir_csll,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESTINACAO'),0)     AS destinacao
    FROM grp_mes g GROUP BY g.ym
  ),
  res AS (
    SELECT ym, rob, deducoes, impostos, cmv, desp_var, desp_fixa, deprec, result_fin, nao_oper, ir_csll, destinacao,
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
           jsonb_object_agg(g.ym, round(gm.signo * g.v, 2)) AS valores_mes
    FROM gmap gm JOIN grp_mes g ON g.dre_grupo = gm.dre_grupo
    GROUP BY gm.header_ordem, gm.dre_grupo, gm.nome, gm.sinal
    UNION ALL
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
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ym, round(
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

-- 4) DRE horizontal por DIA (1 mês): seção "Destinação do Lucro" abaixo do Lucro Líquido
--    (só no ramo realizado competência/caixa; o ramo 'previsto' é fluxo de caixa e mantém a saída).
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal_dia(p_company_ids uuid[], p_ano integer, p_mes integer, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := make_date(p_ano, p_mes, 1);
  v_fim      date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_empresas int  := 0;
  v_dias     jsonb;
  v_linhas   jsonb;
  v_saldo_ini numeric := 0;
  v_dia_neg   text;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada'); END IF;
  IF p_ano < 2024 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Período anterior a 2024 não disponível'); END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo'); END IF;

  SELECT jsonb_agg(jsonb_build_object('d', d, 'ymd', to_char(make_date(p_ano,p_mes,d),'YYYY-MM-DD')) ORDER BY d)
    INTO v_dias FROM generate_series(1, extract(day FROM v_fim)::int) d;

  IF v_regime = 'previsto' THEN
    v_saldo_ini := COALESCE(public.fn_saldo_bancos_dinamico(p_company_ids), 0);

    SELECT count(*) INTO v_empresas FROM (
      SELECT company_id FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','recebido','cancelado') AND data_vencimento::date BETWEEN v_ini AND v_fim
      UNION
      SELECT company_id FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','cancelado') AND data_vencimento::date BETWEEN v_ini AND v_fim
    ) e;

    WITH ent AS (
      SELECT best.psgc_codigo AS codigo, r.data_vencimento::date AS dia, COALESCE(r.valor,0) AS valor
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND r.data_vencimento IS NOT NULL
        AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
        AND r.data_vencimento::date BETWEEN v_ini AND v_fim
    ),
    sai AS (
      SELECT best.psgc_codigo AS codigo, p.data_vencimento::date AS dia, COALESCE(p.valor,0) AS valor
      FROM erp_pagar p
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND p.data_vencimento IS NOT NULL
        AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
        AND p.data_vencimento::date BETWEEN v_ini AND v_fim
    ),
    ent_cd AS (SELECT COALESCE(codigo,'PREV_SC_ENT') AS codigo, to_char(dia,'YYYY-MM-DD') AS ymd, SUM(valor) AS v FROM ent GROUP BY 1,2),
    sai_cd AS (SELECT COALESCE(codigo,'PREV_SC_SAI') AS codigo, to_char(dia,'YYYY-MM-DD') AS ymd, SUM(valor) AS v FROM sai GROUP BY 1,2),
    dd AS (SELECT to_char(make_date(p_ano,p_mes,d),'YYYY-MM-DD') AS ymd, d FROM generate_series(1, extract(day FROM v_fim)::int) d),
    day_tot AS (
      SELECT dd.ymd, dd.d,
        COALESCE((SELECT SUM(v) FROM ent_cd WHERE ent_cd.ymd = dd.ymd),0) AS ent,
        COALESCE((SELECT SUM(v) FROM sai_cd WHERE sai_cd.ymd = dd.ymd),0) AS sai
      FROM dd
    ),
    acc AS (SELECT ymd, d, ent, sai, (ent - sai) AS mov, v_saldo_ini + SUM(ent - sai) OVER (ORDER BY d) AS saldo FROM day_tot),
    ent_contas AS (
      SELECT ec.codigo, COALESCE(c.nome,'Sem classificação') AS nome,
        (CASE WHEN ec.codigo='PREV_SC_ENT' THEN 1000.999 ELSE 1000 + COALESCE(c.dre_ordem,900)*0.001 END) AS ordem,
        jsonb_object_agg(ec.ymd, round(ec.v,2)) AS valores_dia
      FROM ent_cd ec LEFT JOIN psgc_contas c ON c.codigo = ec.codigo
      GROUP BY ec.codigo, c.nome, c.dre_ordem
    ),
    sai_contas AS (
      SELECT sc.codigo, COALESCE(c.nome,'Sem classificação') AS nome,
        (CASE WHEN sc.codigo='PREV_SC_SAI' THEN 2000.999 ELSE 2000 + COALESCE(c.dre_ordem,900)*0.001 END) AS ordem,
        jsonb_object_agg(sc.ymd, round(sc.v,2)) AS valores_dia
      FROM sai_cd sc LEFT JOIN psgc_contas c ON c.codigo = sc.codigo
      GROUP BY sc.codigo, c.nome, c.dre_ordem
    ),
    linhas AS (
      SELECT 1000::numeric AS ordem, jsonb_build_object('ordem',1000,'kind','grupo','codigo','PREV_ENT','nome','Entradas previstas','grupo_ref','PREV_ENT','sinal','+','nivel',0,'colapsavel',true,
        'valores_dia',COALESCE((SELECT jsonb_object_agg(ymd, round(v,2)) FROM (SELECT ymd, SUM(v) v FROM ent_cd GROUP BY ymd) z),'{}'::jsonb)) AS l
      UNION ALL
      SELECT ordem, jsonb_build_object('ordem',ordem,'kind','conta','codigo',codigo,'nome',nome,'grupo_ref','PREV_ENT','sinal','+','nivel',1,'colapsavel',false,'valores_dia',valores_dia) FROM ent_contas
      UNION ALL
      SELECT 2000::numeric, jsonb_build_object('ordem',2000,'kind','grupo','codigo','PREV_SAI','nome','Saídas previstas','grupo_ref','PREV_SAI','sinal','-','nivel',0,'colapsavel',true,
        'valores_dia',COALESCE((SELECT jsonb_object_agg(ymd, round(v,2)) FROM (SELECT ymd, SUM(v) v FROM sai_cd GROUP BY ymd) z),'{}'::jsonb))
      UNION ALL
      SELECT ordem, jsonb_build_object('ordem',ordem,'kind','conta','codigo',codigo,'nome',nome,'grupo_ref','PREV_SAI','sinal','-','nivel',1,'colapsavel',false,'valores_dia',valores_dia) FROM sai_contas
      UNION ALL
      SELECT 3000::numeric, jsonb_build_object('ordem',3000,'kind','resultado','codigo','MOVIMENTO','nome','Movimento do dia','sinal','±','nivel',0,'colapsavel',false,
        'valores_dia',(SELECT jsonb_object_agg(ymd, round(mov,2)) FROM acc))
      UNION ALL
      SELECT 4000::numeric, jsonb_build_object('ordem',4000,'kind','resultado','codigo','SALDO','nome','Saldo acumulado projetado','sinal','=','nivel',0,'colapsavel',false,
        'valores_dia',(SELECT jsonb_object_agg(ymd, round(saldo,2)) FROM acc))
    )
    SELECT jsonb_agg(l ORDER BY ordem), (SELECT min(ymd) FROM acc WHERE saldo < 0)
      INTO v_linhas, v_dia_neg FROM linhas;

    RETURN jsonb_build_object(
      'ok', true, 'regime', 'previsto', 'empresas', v_empresas,
      'ano', p_ano, 'mes', p_mes, 'dias_no_mes', extract(day FROM v_fim)::int,
      'dias', COALESCE(v_dias, '[]'::jsonb), 'linhas', COALESCE(v_linhas, '[]'::jsonb),
      'saldo_inicial', round(v_saldo_ini, 2), 'dia_negativo', v_dia_neg
    );
  END IF;

  WITH raw AS (
    SELECT COALESCE(best.psgc_codigo, '1.4') AS psgc_codigo,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
           COALESCE(r.valor,0) AS valor, r.company_id
    FROM erp_receber r
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status <> 'cancelado')
      AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim AND (CASE WHEN v_regime='caixa' THEN COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito') ELSE NOT COALESCE(r.eh_repasse_cartao,false) END)
    UNION ALL
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo, v.data_emissao AS dia,
           COALESCE(v.valor_distribuido,0) AS valor, v.company_id
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
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo, p.data_pagamento::date AS dia,
           COALESCE(p.valor,0) AS valor, p.company_id
    FROM erp_pagar p
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE v_regime = 'caixa' AND p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND p.data_pagamento::date BETWEEN v_ini AND v_fim
  ),
  gmap(dre_grupo, header_ordem, sinal, nome, signo) AS (VALUES
    ('ROB',1000,'+','Receita Operacional Bruta',1),('DEDUCOES',2000,'-','(−) Deduções',-1),
    ('IMPOSTOS_VENDA',2100,'-','(−) Impostos sobre Vendas',-1),('CMV',3100,'-','(−) CMV / CPV / CSP',-1),
    ('DESP_VARIAVEL',4100,'-','(−) Despesas Variáveis',-1),('DESP_FIXA',5100,'-','(−) Despesas Fixas',-1),
    ('DEPREC_AMORT',6100,'-','(−) Depreciação e Amortização',-1),('RESULT_FIN',7100,'±','(±) Resultado Financeiro',-1),
    ('NAO_OPER',7200,'±','(±) Resultado Não-Operacional',-1),('IR_CSLL',8100,'-','(−) IR e CSLL',-1),
    ('DESTINACAO',9500,'-','Destinação do Lucro',-1)
  ),
  conta_dia AS (
    SELECT r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD') AS ymd, SUM(r.valor) AS v
    FROM raw r JOIN psgc_contas c ON c.codigo = r.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO' AND r.dia IS NOT NULL GROUP BY r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD')
  ),
  grp_dia AS (SELECT dre_grupo, ymd, SUM(v) AS v FROM conta_dia GROUP BY dre_grupo, ymd),
  pivot AS (
    SELECT ymd,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='ROB'),0) AS rob,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEDUCOES'),0) AS deducoes,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IMPOSTOS_VENDA'),0) AS impostos,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='CMV'),0) AS cmv,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_VARIAVEL'),0) AS desp_var,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_FIXA'),0) AS desp_fixa,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEPREC_AMORT'),0) AS deprec,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='RESULT_FIN'),0) AS result_fin,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='NAO_OPER'),0) AS nao_oper,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0) AS ir_csll,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESTINACAO'),0) AS destinacao
    FROM grp_dia GROUP BY ymd
  ),
  res AS (
    SELECT ymd,
      (rob-deducoes-impostos) AS rl, (rob-deducoes-impostos-cmv) AS mb,
      (rob-deducoes-impostos-cmv-desp_var) AS mc, (rob-deducoes-impostos-cmv-desp_var-desp_fixa) AS ebitda,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec) AS ebit,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper) AS rai,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper-ir_csll) AS ll,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper-ir_csll-destinacao) AS lrt
    FROM pivot
  ),
  res_lines(ordem, codigo, nome) AS (VALUES
    (3000,'RL','= Receita Líquida'),(4000,'MB','= Margem Bruta'),(5000,'MC','= Margem de Contribuição'),
    (6000,'EBITDA','= EBITDA'),(7000,'EBIT','= EBIT (Resultado Operacional)'),
    (8000,'RAI','= Resultado antes do IR/CSLL'),(9000,'LL','= Lucro Líquido'),
    (9900,'LRT','= Lucro Líquido Retido')
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
    FROM conta_dia cd JOIN psgc_contas c ON c.codigo = cd.psgc_codigo JOIN gmap gm ON gm.dre_grupo = c.dre_grupo
    GROUP BY c.codigo, c.nome, c.dre_ordem, gm.header_ordem, gm.dre_grupo, gm.sinal,
             c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda
    UNION ALL
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ymd, round(
             CASE rl.codigo WHEN 'RL' THEN r.rl WHEN 'MB' THEN r.mb WHEN 'MC' THEN r.mc
               WHEN 'EBITDA' THEN r.ebitda WHEN 'EBIT' THEN r.ebit WHEN 'RAI' THEN r.rai
               WHEN 'LL' THEN r.ll WHEN 'LRT' THEN r.lrt END, 2))
    FROM res_lines rl CROSS JOIN res r GROUP BY rl.ordem, rl.codigo, rl.nome
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ordem', ordem, 'kind', kind, 'codigo', codigo, 'nome', nome,
           'grupo_ref', grupo_ref, 'sinal', sinal, 'nivel', nivel, 'colapsavel', colapsavel,
           'afeta_margem_bruta', mb, 'afeta_margem_contribuicao', mc, 'afeta_ebitda', eb,
           'valores_dia', valores_dia
         )) ORDER BY ordem)
    INTO v_linhas FROM linhas;

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
    'dias', COALESCE(v_dias, '[]'::jsonb), 'linhas', COALESCE(v_linhas, '[]'::jsonb)
  );
END $function$;

-- 5) DRE consolidada (dashboard universal): "(−) Destinação do Lucro" + "= Lucro Líquido Retido".
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_consolidada(p_company_ids uuid[], p_ano integer, p_mes integer)
 RETURNS TABLE(ordem integer, linha text, tipo text, valor numeric, valor_abs numeric, qtd_empresas integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT fn_empresas_produtivas());  -- [DEMO-F1 p3] defesa: so producao no consolidado

  RETURN QUERY
  WITH agregado AS (
    SELECT
      c.dre_grupo,
      MIN(c.dre_ordem) as ordem_grupo,
      SUM(d.valor) as valor_grupo,
      COUNT(DISTINCT d.company_id)::int as empresas
    FROM psgc_dre d
    JOIN psgc_contas c ON c.codigo = d.psgc_codigo
    WHERE d.company_id = ANY(p_company_ids)
      AND d.ano = p_ano
      AND d.mes = p_mes
      AND c.dre_grupo != 'NEUTRO'
      AND COALESCE(d.regime, 'competencia') = 'competencia'  -- ✅ FIX FOUNDATIONAL
    GROUP BY c.dre_grupo
  ),
  calc AS (
    SELECT
      SUM(CASE WHEN dre_grupo = 'ROB' THEN valor_grupo ELSE 0 END) as rob,
      SUM(CASE WHEN dre_grupo = 'DEDUCOES' THEN valor_grupo ELSE 0 END) as deducoes,
      SUM(CASE WHEN dre_grupo = 'IMPOSTOS_VENDA' THEN valor_grupo ELSE 0 END) as impostos,
      SUM(CASE WHEN dre_grupo = 'CMV' THEN valor_grupo ELSE 0 END) as cmv,
      SUM(CASE WHEN dre_grupo = 'DESP_VARIAVEL' THEN valor_grupo ELSE 0 END) as desp_var,
      SUM(CASE WHEN dre_grupo = 'DESP_FIXA' THEN valor_grupo ELSE 0 END) as desp_fixa,
      SUM(CASE WHEN dre_grupo = 'DEPREC_AMORT' THEN valor_grupo ELSE 0 END) as deprec,
      SUM(CASE WHEN dre_grupo = 'RESULT_FIN' THEN valor_grupo ELSE 0 END) as result_fin,
      SUM(CASE WHEN dre_grupo = 'NAO_OPER' THEN valor_grupo ELSE 0 END) as nao_oper,
      SUM(CASE WHEN dre_grupo = 'IR_CSLL' THEN valor_grupo ELSE 0 END) as ir_csll,
      SUM(CASE WHEN dre_grupo = 'DESTINACAO' THEN valor_grupo ELSE 0 END) as destinacao,
      MAX(empresas) as qtd_emp
    FROM agregado
  )
  SELECT * FROM (VALUES
    (1,  'Receita Operacional Bruta',     'titulo',          (SELECT rob FROM calc),           (SELECT rob FROM calc)),
    (2,  '(−) Deduções',                   'subtracao',      -(SELECT deducoes FROM calc),      (SELECT deducoes FROM calc)),
    (3,  '(−) Impostos sobre Vendas',     'subtracao',      -(SELECT impostos FROM calc),      (SELECT impostos FROM calc)),
    (4,  '= Receita Líquida',              'calculado',       (SELECT rob - deducoes - impostos FROM calc), (SELECT rob - deducoes - impostos FROM calc)),
    (5,  '(−) CMV/CPV/CSP',               'subtracao',      -(SELECT cmv FROM calc),           (SELECT cmv FROM calc)),
    (6,  '= Margem Bruta',                 'total',           (SELECT rob - deducoes - impostos - cmv FROM calc), (SELECT rob - deducoes - impostos - cmv FROM calc)),
    (7,  '(−) Despesas Variáveis',        'subtracao',      -(SELECT desp_var FROM calc),      (SELECT desp_var FROM calc)),
    (8,  '= Margem de Contribuição',       'total',           (SELECT rob - deducoes - impostos - cmv - desp_var FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var FROM calc)),
    (9,  '(−) Despesas Fixas',            'subtracao',      -(SELECT desp_fixa FROM calc),     (SELECT desp_fixa FROM calc)),
    (10, '= EBITDA',                       'total',           (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa FROM calc)),
    (11, '(−) Depreciação e Amortização', 'subtracao',      -(SELECT deprec FROM calc),        (SELECT deprec FROM calc)),
    (12, '= EBIT (Resultado Operacional)','total',           (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec FROM calc)),
    (13, '(±) Resultado Financeiro',       'soma',           -(SELECT result_fin FROM calc),    (SELECT result_fin FROM calc)),
    (14, '(±) Resultado Não-Operacional', 'soma',           -(SELECT nao_oper FROM calc),      (SELECT nao_oper FROM calc)),
    (15, '= Resultado antes do IR/CSLL',   'total',           (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper FROM calc)),
    (16, '(−) IR e CSLL',                 'subtracao',      -(SELECT ir_csll FROM calc),       (SELECT ir_csll FROM calc)),
    (17, '= LUCRO LÍQUIDO',                'resultado_final', (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll FROM calc)),
    (18, '(−) Destinação do Lucro',       'subtracao',      -(SELECT destinacao FROM calc),    (SELECT destinacao FROM calc)),
    (19, '= Lucro Líquido Retido',         'resultado_final', (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll - destinacao FROM calc), (SELECT rob - deducoes - impostos - cmv - desp_var - desp_fixa - deprec - result_fin - nao_oper - ir_csll - destinacao FROM calc))
  ) AS t(ordem, linha, tipo, valor, valor_abs)
  CROSS JOIN (SELECT qtd_emp FROM calc) q
  ;
END;
$function$;
