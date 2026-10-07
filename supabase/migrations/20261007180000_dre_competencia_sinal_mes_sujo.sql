-- DRE (núcleo, todas as empresas) — 3 defeitos PROVADOS (Eng. Chefe 07/10, msgs 32327000 e 5b12de3b). Via revisada.
--  (1) competência: os blocos PAGAR/RECEBER DIRETO filtravam por data_emissao e ignoravam data_competencia
--      → agora COALESCE(data_competencia, data_emissao) (pagar e receber, inclusive as flags v_tem_*_emissao).
--  (A) sinal: receita que o de-para manda para NAO_OPER/RESULT_FIN (ex.: 1.04 → 9.2) era gravada POSITIVA e as leituras
--      (fn_psgc_dre_horizontal etc.) tratam esses grupos como despesa (signo −1) → a receita era SUBTRAÍDA. Passa a ser
--      gravada com o sinal do grupo (negativa), e a leitura a mostra positiva e soma no lucro. Vale nos 3 blocos de receber
--      (omie, direto, caixa). O ramo erp_lancamentos mistura pagar e receita na mesma agregação (não alterado).
--  (B) mês sujo: o trigger só enfileirava o mês da data_emissao; pagamento em outro mês (ou mudança de competência)
--      deixava o mês afetado sem recálculo → agora enfileira também o mês da competência e o do pagamento, novos e antigos.
-- Depende de: nada além do que já existe. Sem DROP/DELETE de dado de cliente (o DELETE do mês dentro da função é o já existente).
-- O recálculo dos meses afetados é feito DEPOIS do merge, pela fila do PSGC (não em lote).

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

  -- [DRE competência] mês de competência = COALESCE(data_competencia, data_emissao)
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
    -- ===== RAMO OMIE (pagar INALTERADO, RD-53; receber só ganha o sinal do grupo) =====
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
        COALESCE(r.valor, 0) * CASE WHEN pcs.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END as v, 1 as q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd
        JOIN psgc_contas pc ON pc.codigo=pd.psgc_codigo
        WHERE pd.company_id=r.company_id AND pd.origem_codigo=r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) pd ON true
      LEFT JOIN psgc_contas pcs ON pcs.codigo = COALESCE(pd.psgc_codigo, '1.4')
      LEFT JOIN LATERAL fn_psgc_classificar_ln(r.company_id, COALESCE((SELECT descricao FROM erp_plano_contas WHERE company_id=r.company_id AND codigo=r.categoria LIMIT 1), r.categoria, r.descricao, '')) cln ON true
      WHERE r.company_id=p_company_id AND r.data_emissao IS NOT NULL
        AND r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status != 'cancelado')
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
    -- ===== PAGAR DIRETO (competência) — honra o de-para operacional; mês = COALESCE(data_competencia, data_emissao) =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_direto', 'competencia'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,                                                   -- NEUTRO/DESTINACAO (0.x, fora do resultado)
          dpop.psgc_codigo,                                                  -- de-para operacional (CMV/DESP_*/IMPOSTOS_VENDA/NAO_OPER)
          CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') ELSE '6.11' END  -- fallback ATUAL mantido
        ) AS codigo_psgc,
        p.valor AS v, 1 AS q
      FROM erp_pagar p
      LEFT JOIN erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria
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
    -- ===== RECEBER DIRETO (competência) — honra o de-para; mês = COALESCE(data_competencia, data_emissao); sinal do grupo =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_direto', 'competencia'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc,
             r.valor * CASE WHEN pcs.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END AS v, 1 AS q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN psgc_contas pcs ON pcs.codigo = COALESCE(dp.psgc_codigo, '1.4')
      WHERE r.company_id=p_company_id AND COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
        AND COALESCE(r.data_competencia, r.data_emissao)::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status != 'cancelado')
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_pagar_caixa THEN
    -- ===== PAGAR CAIXA — honra o de-para operacional (INALTERADO) =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_caixa', 'caixa'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,
          dpop.psgc_codigo,
          CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') ELSE '6.11' END
        ) AS codigo_psgc,
        p.valor AS v, 1 AS q
      FROM erp_pagar p
      LEFT JOIN erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria
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
    -- ===== RECEBER CAIXA — honra o de-para; sinal do grupo (receita não-op/financeira entra negativa no grupo-despesa) =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_caixa', 'caixa'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc,
             r.valor * CASE WHEN pcs.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END AS v, 1 AS q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      LEFT JOIN psgc_contas pcs ON pcs.codigo = COALESCE(dp.psgc_codigo, '1.4')
      WHERE r.company_id=p_company_id AND r.data_pagamento IS NOT NULL
        AND r.data_pagamento::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
        AND (r.status IS NULL OR r.status != 'cancelado')
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

-- (B) trigger: enfileira também o mês da competência e o do pagamento (novos e antigos), além do da emissão (já existente).
CREATE OR REPLACE FUNCTION public.trg_psgc_enfileirar_lancamento()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_data date; v_data_old date; v_company uuid; v_ref text;
  -- campos que fn_psgc_recalcular_dre_mes / _fluxo / _abc leem; qualquer outro (ultima_sync, importado_em,
  -- updated_at, observação…) não muda o resultado → não enfileira. [DRE competência] + data_competencia
  c_campos constant text[] := ARRAY['company_id','data_emissao','data_competencia','data_pagamento','valor','valor_documento','valor_distribuido',
                                     'categoria','status','deleted_at','plano_conta_codigo','psgc_codigo','business_line_id','ln_id'];
  v_old jsonb; v_new jsonb; v_mudou boolean := false; k text;
  v_extra date; v_meses_extra date[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOREACH k IN ARRAY c_campos LOOP
      IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN v_mudou := true; EXIT; END IF;
    END LOOP;
    IF NOT v_mudou THEN RETURN NEW; END IF;
  END IF;

  v_company := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  v_ref := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  v_data := fn_parse_data_text(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_emissao::text ELSE NEW.data_emissao::text END);
  IF TG_OP = 'UPDATE' THEN v_data_old := fn_parse_data_text(OLD.data_emissao::text); END IF;

  IF v_data IS NOT NULL THEN
    PERFORM fn_psgc_enfileirar(v_company, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_data)::int, EXTRACT(MONTH FROM v_data)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
    PERFORM fn_psgc_enfileirar(v_company, 'recalcular_abc', EXTRACT(YEAR FROM v_data)::int, NULL, 7, 'trigger:' || TG_TABLE_NAME);
    IF TG_TABLE_NAME IN ('erp_pagar', 'erp_receber') THEN
      PERFORM fn_psgc_enfileirar(v_company, 'recalcular_fluxo', EXTRACT(YEAR FROM v_data)::int, EXTRACT(MONTH FROM v_data)::int, 6, 'trigger:' || TG_TABLE_NAME);
    END IF;
  END IF;
  -- data_emissao mudou de mês (ou de empresa): o mês antigo também precisa ser refeito
  IF TG_OP = 'UPDATE' AND v_data_old IS NOT NULL
     AND (v_data IS NULL OR date_trunc('month', v_data_old) <> date_trunc('month', v_data) OR OLD.company_id IS DISTINCT FROM NEW.company_id) THEN
    PERFORM fn_psgc_enfileirar(OLD.company_id, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_data_old)::int, EXTRACT(MONTH FROM v_data_old)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
    IF TG_TABLE_NAME IN ('erp_pagar', 'erp_receber') THEN
      PERFORM fn_psgc_enfileirar(OLD.company_id, 'recalcular_fluxo', EXTRACT(YEAR FROM v_data_old)::int, EXTRACT(MONTH FROM v_data_old)::int, 6, 'trigger:' || TG_TABLE_NAME);
    END IF;
  END IF;

  -- [DRE competência / caixa] mês da competência e do pagamento: o NOVO (empresa nova) e o ANTIGO (empresa antiga)
  IF TG_TABLE_NAME IN ('erp_pagar', 'erp_receber') THEN
    IF TG_OP <> 'DELETE' THEN
      v_meses_extra := ARRAY[(to_jsonb(NEW) ->> 'data_competencia')::date, (to_jsonb(NEW) ->> 'data_pagamento')::date];
      FOREACH v_extra IN ARRAY v_meses_extra LOOP
        CONTINUE WHEN v_extra IS NULL OR date_trunc('month', v_extra) = date_trunc('month', v_data);
        PERFORM fn_psgc_enfileirar(NEW.company_id, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_extra)::int, EXTRACT(MONTH FROM v_extra)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
      END LOOP;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      v_meses_extra := ARRAY[(to_jsonb(OLD) ->> 'data_competencia')::date, (to_jsonb(OLD) ->> 'data_pagamento')::date];
      FOREACH v_extra IN ARRAY v_meses_extra LOOP
        CONTINUE WHEN v_extra IS NULL OR date_trunc('month', v_extra) = date_trunc('month', v_data_old);
        PERFORM fn_psgc_enfileirar(OLD.company_id, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_extra)::int, EXTRACT(MONTH FROM v_extra)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
      END LOOP;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao enfileirar recálculo PSGC: %', SQLERRM;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
