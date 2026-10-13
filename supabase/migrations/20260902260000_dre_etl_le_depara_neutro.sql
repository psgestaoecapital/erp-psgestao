-- DRE · fix mínimo e cirúrgico: os ramos de PAGAR direto (etl_pagar_direto / etl_pagar_caixa) do
-- classificador fn_psgc_recalcular_dre_mes passam a LER de-para de contas NEUTRO (0.1/0.2/0.3).
--
-- Motivo: empresas sem Omie/erp_lancamentos caem nesses ramos, que hoje classificam tudo que não é
-- 'investimento' no default 6.11 — e a busca de de-para só olhava dre_grupo='NAO_OPER'. Resultado:
-- distribuição/retirada de lucro (0.3, NEUTRO — movimento de patrimônio, fora do DRE) ficava como
-- DESPESA em 6.11, subestimando o lucro. Ex. provado: Estância Umuarama R$200.000 (Distribuição Ivan
-- R$150k + Retirada Fran R$50k), ambos com categoria NULA.
--
-- Escopo (provado no dado): entre as 9 empresas direto-pagar, ZERO títulos casam de-para NEUTRO hoje;
-- R.R (que tem um 2.04.07→0.1) é Omie e usa outro ramo. Então o acréscimo só age em títulos
-- explicitamente mapeados a conta NEUTRO. NÃO é o pacote de arquitetura (55% sem match / ler todos os
-- grupos / import da Stel) — isso fica para decisão separada do CEO.
--
-- Aditivo: um LATERAL de de-para NEUTRO entra por COALESCE ANTES do CASE existente, nos dois ramos.

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
          ndp.psgc_codigo,  -- FIX: de-para NEUTRO (ex.: distribuição 0.3) tem prioridade e sai do DRE
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
          AND pcx.dre_grupo = 'NEUTRO'
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
          ndp.psgc_codigo,  -- FIX: de-para NEUTRO (ex.: distribuição 0.3) tem prioridade e sai do DRE
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
          AND pcx.dre_grupo = 'NEUTRO'
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

-- ===== Dado: os 2 títulos de distribuição de lucro da Estância Umuarama (categoria NULA) =====
-- Preenche a categoria e cria o de-para -> 0.3 (idempotente). São: "Distribuição de Lucros - Ivan"
-- R$150.000 e "Retirada de Lucros - Fran" R$50.000, ambos venc/pagos 14/08/2026.
UPDATE public.erp_pagar SET categoria='Distribuição de Lucros'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
   AND id IN ('36213cc6-abc3-45f2-95d6-0b876020738f','7ce7df0b-5444-429a-b8e7-6eb99682cfb5')
   AND categoria IS NULL;

INSERT INTO public.psgc_depara (company_id, origem_codigo, origem_descricao, origem_sistema, psgc_codigo, metodo, confianca, revisado, ativo)
SELECT '636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','Distribuição de Lucros','Distribuição de Lucros','manual','0.3','manual',100,true,true
WHERE NOT EXISTS (
  SELECT 1 FROM public.psgc_depara WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
    AND origem_codigo='Distribuição de Lucros' AND ativo);

-- Recalcula os meses afetados (caixa m8 pelo pagamento 14/08; competência m9 pela emissão 02/09)
SELECT public.fn_psgc_recalcular_dre_mes('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38',2026,8);
SELECT public.fn_psgc_recalcular_dre_mes('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38',2026,9);
