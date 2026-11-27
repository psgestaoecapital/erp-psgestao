-- fix(financeiro/dre-consolidado · núcleo · RD-38): DRE regime CAIXA lê das BAIXAS, não do título cheio
--
-- Tela: /dashboard/financeiro/dre-consolidado (regra CEO 21/11 — citar a tela).
--
-- BUGS CORRIGIDOS (provados no dado · DEMO GE b0700000-0000-4000-a000-000000000004):
--   1) [CRÍTICO · super-conta parcial] etl_receber_caixa / etl_pagar_caixa usavam o valor CHEIO do título
--      (r.valor / p.valor) como "dinheiro que entrou/saiu". Um título PARCIAL (ex.: título 1.160, baixa 464)
--      lançava 1.160 no caixa — super-reporta receita/despesa realizada para QUALQUER cliente com baixa parcial.
--   2) [CRÍTICO · título some] o filtro era r.data_pagamento / p.data_pagamento IS NOT NULL. Um título com baixa
--      real (linha em erp_receber_baixa/erp_pagar_baixa) mas data_pagamento NULL no cabeçalho sumia do caixa inteiro.
--
-- CORREÇÃO (uma só resolve os dois, simétrica receber/pagar): o regime CAIXA passa a ler da FONTE-VERDADE do
-- dinheiro que entrou/saiu — erp_receber_baixa / erp_pagar_baixa (b.deleted_at IS NULL):
--   - valor         = SUM(b.valor) das baixas (não o valor cheio do título);
--   - competência   = mês de b.data (data da baixa), não data_pagamento do cabeçalho;
--   - gate v_tem_*_caixa também passa a olhar as baixas do mês (senão o bloco nem roda p/ título com data_pagamento NULL);
--   - cartão (só receber): exclusão passa a olhar a forma REALIZADA da baixa (lower(b.forma));
--   - de-para psgc por categoria do título (r.categoria / p.categoria) e demais guards: INALTERADOS.
--
-- Espelha o reconhecimento de caixa dos dois lados. ACEITE (DEMO): etl_receber_caixa = 3.994,00
-- (08=464, 09=2.500+1.030=3.530) = SUM(erp_receber_baixa). Teste @pos-migration cobre parcial e data_pagamento NULL.
-- Ramos OMIE / lançamentos / competência (etl_*_direto, etl_receber, etl_lancamento): INALTERADOS. RD-104 n/a.

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
  -- [GE G0-F / RD-69] passa a honrar empresas de demonstração (is_demo), sem promovê-las a 'producao'.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND (ambiente_tenant = 'producao' OR is_demo IS TRUE)) THEN
    RETURN;
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
    WHERE company_id=p_company_id AND COALESCE(data_competencia, data_emissao) IS NOT NULL
      AND COALESCE(data_competencia, data_emissao) BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );
  v_tem_receber_emissao := EXISTS(
    SELECT 1 FROM erp_receber
    WHERE company_id=p_company_id AND COALESCE(data_competencia, data_emissao) IS NOT NULL
      AND COALESCE(data_competencia, data_emissao)::date BETWEEN v_data_inicio AND v_data_fim AND deleted_at IS NULL LIMIT 1
  );

  -- [FIX] gate do CAIXA do PAGAR olha as BAIXAS do mês (não data_pagamento do cabeçalho).
  v_tem_pagar_caixa := EXISTS(
    SELECT 1 FROM erp_pagar_baixa b
    JOIN erp_pagar p ON p.id = b.pagar_id
    WHERE p.company_id=p_company_id AND b.deleted_at IS NULL AND p.deleted_at IS NULL
      AND b.data BETWEEN v_data_inicio AND v_data_fim
      AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado')) LIMIT 1
  );
  -- [FIX] gate do CAIXA do RECEBER olha as BAIXAS do mês (senão título baixado com data_pagamento NULL some).
  v_tem_receber_caixa := EXISTS(
    SELECT 1 FROM erp_receber_baixa b
    JOIN erp_receber r ON r.id = b.receber_id
    WHERE r.company_id=p_company_id AND b.deleted_at IS NULL AND r.deleted_at IS NULL
      AND b.data BETWEEN v_data_inicio AND v_data_fim
      AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado')) LIMIT 1
  );

  DELETE FROM psgc_dre WHERE company_id = p_company_id AND ano = p_ano AND mes = p_mes;

  IF v_tem_omie THEN
    -- ===== RAMO OMIE — INALTERADO (RD-53) =====
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
        SELECT pd.psgc_codigo, pc.dre_grupo FROM psgc_depara pd
        JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
        WHERE pd.company_id=r.company_id AND pd.origem_codigo=r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) pd ON true
      LEFT JOIN LATERAL fn_psgc_classificar_ln(r.company_id, COALESCE((SELECT descricao FROM erp_plano_contas WHERE company_id=r.company_id AND codigo=r.categoria LIMIT 1), r.categoria, r.descricao, '')) cln ON true
      WHERE r.company_id=p_company_id AND COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
        AND COALESCE(r.data_competencia, r.data_emissao)::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
    ) sub GROUP BY ln_id_val, ln_nome_val, codigo_psgc
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();

  ELSIF v_tem_lancamentos_no_mes THEN
    -- ===== RAMO LANÇAMENTOS — INALTERADO (RD-53) =====
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
    -- ===== PAGAR DIRETO (competência) — INALTERADO =====
    WITH her AS (SELECT * FROM fn_psgc_depara_herdado(p_company_id))
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_direto', 'competencia'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,                                                   -- NEUTRO/DESTINACAO (0.x, fora do resultado)
          dpop.psgc_codigo,                                                  -- de-para operacional (CMV/DESP_*/IMPOSTOS_VENDA/NAO_OPER)
          her.psgc_codigo,
          CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') WHEN epc.tipo = 'custo' THEN '4.1' ELSE '6.11' END  -- fallback ATUAL mantido
        ) AS codigo_psgc,
        p.valor AS v, 1 AS q
      FROM erp_pagar p
      LEFT JOIN erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria LEFT JOIN her ON her.origem_codigo = p.categoria
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo = 'NAO_OPER'
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo IN ('NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) ndp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP','NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dpop ON true
      WHERE p.company_id = p_company_id AND COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL
        AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_data_inicio AND v_data_fim AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_receber_emissao AND NOT v_tem_lancamentos_no_mes AND NOT v_tem_omie THEN
    -- ===== RECEBER DIRETO (competência) — INALTERADO =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_direto', 'competencia'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc,
             r.valor AS v, 1 AS q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo, pcx.dre_grupo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      WHERE r.company_id=p_company_id AND COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
        AND COALESCE(r.data_competencia, r.data_emissao)::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_pagar_caixa THEN
    -- ===== PAGAR CAIXA — [FIX] lê das BAIXAS (erp_pagar_baixa): valor=b.valor, competência=b.data =====
    WITH her AS (SELECT * FROM fn_psgc_depara_herdado(p_company_id))
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_caixa', 'caixa'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,
          dpop.psgc_codigo,
          her.psgc_codigo,
          CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') WHEN epc.tipo = 'custo' THEN '4.1' ELSE '6.11' END
        ) AS codigo_psgc,
        b.valor AS v, 1 AS q
      FROM erp_pagar_baixa b
      JOIN erp_pagar p ON p.id = b.pagar_id
      LEFT JOIN erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria LEFT JOIN her ON her.origem_codigo = p.categoria
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo = 'NAO_OPER'
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo IN ('NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) ndp ON true
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pcx.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP','NEUTRO','DESTINACAO')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dpop ON true
      WHERE p.company_id = p_company_id AND b.deleted_at IS NULL
        AND b.data BETWEEN v_data_inicio AND v_data_fim AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_receber_caixa THEN
    -- ===== RECEBER CAIXA — [FIX] lê das BAIXAS (erp_receber_baixa): valor=b.valor, competência=b.data =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_caixa', 'caixa'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc,
             b.valor AS v, 1 AS q
      FROM erp_receber_baixa b
      JOIN erp_receber r ON r.id = b.receber_id
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo, pcx.dre_grupo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      WHERE r.company_id=p_company_id AND b.deleted_at IS NULL
        AND b.data BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL
        AND lower(COALESCE(b.forma,'')) NOT IN ('cartao_debito','cartao_credito')
        AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=EXCLUDED.valor, qtd_lancamentos=EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  RETURN QUERY
  SELECT SUM(d.qtd_lancamentos)::bigint, SUM(d.valor)::numeric, COUNT(DISTINCT d.psgc_codigo)::bigint, COUNT(DISTINCT d.ln_id)::bigint
  FROM psgc_dre d WHERE d.company_id=p_company_id AND d.ano=p_ano AND d.mes=p_mes;
END;
$function$;
