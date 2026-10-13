-- GE · ONDA G0 — Bloco 6 (DRE) da Demonstração Comércio GE (empresa 004, is_demo).
-- RD-52 (nome do arquivo = versão do ledger) · RD-69 (demo invisível às métricas reais) · RD-38 (provado no dado).
--
-- 3 condições do CEO:
--   (1) fn_psgc_recalcular_dre_mes passa a rodar para empresas is_demo (sem virar 004 para 'producao').
--   (2) 004 recebe assinatura v15_gestao_empresarial_pro a R$0 (MRR intacto) — semeada em fn_demo_reset.
--   (3) Fechar a exclusão RD-69: demo fora do clientes_ativos E do MRR do briefing, e fora do Truth Auditor
--       de DRE (receita/despesa). As 3 consolidações (fn_psgc_dre_consolidada/_saude/_abc) já excluem demo
--       via fn_empresas_produtivas(); historico_mrr é por-empresa e fn_gold_relatorio_diario audita a própria
--       demo (robô só is_demo) — ambos ficam como estão de propósito.
-- + Semear o DRE de 6 meses (competência + caixa) em fn_demo_reset(004) chamando o recálculo REAL.
--
-- Prova (rollback):
--   · clientes_ativos: 38 ANTES → 37 DEPOIS (o filtro tira a demo Revenda 003 que hoje polui a conta;
--     se continuasse 38, o filtro não teria pego);
--   · MRR: 6.315 antes e depois (a demo poluidora está a R$0, então sair dela não muda o MRR);
--   · após criar a assinatura da 004 a R$0: clientes_ativos segue 37, MRR segue 6.315 (004 é 'auditoria',
--     fora de fn_empresas_produtivas);
--   · DRE 004 populado nos 6 meses (competência+caixa); Truth Auditor não gera alerta para a demo.

-- ============================================================================
-- (0) fn_empresas_produtivas: além de ambiente_tenant='producao', excluir is_demo (defesa em profundidade).
--     Hoje demos_em_producao=0, então a contagem não muda; mas blinda o invariante caso uma demo seja
--     promovida a 'producao'. É este helper que carrega o filtro para briefing (MRR/clientes), Truth e
--     as 3 consolidações (que já o usam).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_empresas_produtivas()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.companies WHERE ambiente_tenant = 'producao' AND is_demo IS NOT TRUE;
$function$;

REVOKE ALL ON FUNCTION public.fn_empresas_produtivas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empresas_produtivas() TO authenticated, service_role;

-- ============================================================================
-- (1) GUARD is_demo em fn_psgc_recalcular_dre_mes — única mudança: a linha do IF NOT EXISTS.
--     (Função é SECURITY INVOKER — fora da régua check_fn_guards.)
-- ============================================================================
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
    -- ===== PAGAR DIRETO (competência) — AGORA HONRA O DE-PARA OPERACIONAL =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc, SUM(v), SUM(q), 'etl_pagar_direto', 'competencia'
    FROM (
      SELECT
        COALESCE(
          ndp.psgc_codigo,                                                   -- NEUTRO/DESTINACAO (0.x, fora do resultado)
          dpop.psgc_codigo,                                                  -- NOVO: de-para operacional (CMV/DESP_*/IMPOSTOS_VENDA/NAO_OPER)
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
    -- ===== RECEBER DIRETO (competência) — AGORA HONRA O DE-PARA (antes hardcodava 1.4) =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_direto', 'competencia'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc, r.valor AS v, 1 AS q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
      WHERE r.company_id=p_company_id AND r.data_emissao IS NOT NULL
        AND r.data_emissao::date BETWEEN v_data_inicio AND v_data_fim AND r.deleted_at IS NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
        AND (r.status IS NULL OR r.status != 'cancelado')
    ) sub
    GROUP BY codigo_psgc
    HAVING SUM(q) > 0
    ON CONFLICT (company_id, ano, mes, ln_id, psgc_codigo, regime, origem_sistema_lancamento, source) DO UPDATE
      SET valor=psgc_dre.valor+EXCLUDED.valor, qtd_lancamentos=psgc_dre.qtd_lancamentos+EXCLUDED.qtd_lancamentos, calculated_at=NOW();
  END IF;

  IF v_tem_pagar_caixa THEN
    -- ===== PAGAR CAIXA — AGORA HONRA O DE-PARA OPERACIONAL =====
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
    -- ===== RECEBER CAIXA — AGORA HONRA O DE-PARA (antes hardcodava 1.4) =====
    INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)
    SELECT p_company_id, p_ano, p_mes,
           (SELECT id FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           (SELECT name FROM business_lines WHERE company_id=p_company_id AND is_active=true ORDER BY ln_number LIMIT 1),
           codigo_psgc, SUM(v), SUM(q), 'etl_receber_caixa', 'caixa'
    FROM (
      SELECT COALESCE(dp.psgc_codigo, '1.4') AS codigo_psgc, r.valor AS v, 1 AS q
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pcx ON pcx.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) dp ON true
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

-- ============================================================================
-- (3) Truth Auditor de DRE: excluir empresas não-produtivas (demos) — única mudança: filtro no CTE real.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  DELETE FROM erp_truth_alerts WHERE rule_id = 'dre_receita_bate_nfs' AND status IN ('novo','ignorado');
  WITH receita_real AS (
    SELECT r.company_id, EXTRACT(YEAR FROM r.data_emissao)::int AS ano, EXTRACT(MONTH FROM r.data_emissao)::int AS mes, SUM(r.valor) AS valor_real
    FROM erp_receber r WHERE r.valor > 0 AND r.data_emissao IS NOT NULL AND NOT COALESCE(r.eh_repasse_cartao,false)
      AND r.company_id IN (SELECT fn_empresas_produtivas())  -- [GE G0-F / RD-69] demos fora do Truth Auditor
    GROUP BY r.company_id, EXTRACT(YEAR FROM r.data_emissao), EXTRACT(MONTH FROM r.data_emissao)
  ),
  receita_psgc AS (SELECT company_id, ano, mes, SUM(valor) AS valor_psgc FROM psgc_dre WHERE regime='competencia' AND source='pr_4_4_re_etl_receita' GROUP BY company_id, ano, mes),
  comparacao AS (
    SELECT r.company_id, r.ano, r.mes, r.valor_real, COALESCE(p.valor_psgc,0) AS valor_psgc, r.valor_real - COALESCE(p.valor_psgc,0) AS delta_abs,
           CASE WHEN r.valor_real>0 THEN ABS((r.valor_real - COALESCE(p.valor_psgc,0))/r.valor_real)*100 ELSE 0 END AS delta_pct
    FROM receita_real r LEFT JOIN receita_psgc p ON p.company_id=r.company_id AND p.ano=r.ano AND p.mes=r.mes
  )
  INSERT INTO erp_truth_alerts (rule_id, company_id, severity, area, tipo_divergencia, valor_esperado, valor_encontrado, delta_percentual, periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at)
  SELECT 'dre_receita_bate_nfs', c.company_id,
    CASE WHEN c.delta_pct>10 OR ABS(c.delta_abs)>50000 THEN 'critical' WHEN c.delta_pct>5 OR ABS(c.delta_abs)>10000 THEN 'warn' ELSE 'info' END,
    'dre','receita_bruta_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01'), (DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01')+INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo',c.ano||'-'||LPAD(c.mes::text,2,'0'),'valor_real_erp_receber',c.valor_real,'valor_psgc_dre',c.valor_psgc,'delta_pct',ROUND(c.delta_pct::numeric,2)),
    CONCAT('Divergencia R$ ',ROUND(ABS(c.delta_abs)::numeric,2),' (',ROUND(c.delta_pct::numeric,1),'%) na receita ',c.ano,'-',LPAD(c.mes::text,2,'0')),
    CASE WHEN c.valor_psgc=0 THEN 'Re-executar PR 4.4 - psgc_dre vazio' WHEN c.delta_pct>10 THEN 'Investigar divergencia critica' WHEN c.delta_pct>1 THEN 'Verificar transferencias/vendas-ativos em erp_receber' ELSE 'Diferenca menor que 1% - tolerancia' END,
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_receita_bate_nfs' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

REVOKE ALL ON FUNCTION public.fn_truth_audit_dre() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_truth_audit_dre() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre_despesa()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  DELETE FROM erp_truth_alerts WHERE rule_id = 'dre_despesas_bate_pagamentos' AND status IN ('novo','ignorado');
  WITH despesa_real AS (
    SELECT p.company_id, EXTRACT(YEAR FROM p.data_emissao)::int AS ano, EXTRACT(MONTH FROM p.data_emissao)::int AS mes, SUM(p.valor) AS valor_real
    FROM erp_pagar p WHERE p.valor>0 AND p.data_emissao IS NOT NULL
      AND p.company_id IN (SELECT fn_empresas_produtivas())  -- [GE G0-F / RD-69] demos fora do Truth Auditor
    GROUP BY p.company_id, EXTRACT(YEAR FROM p.data_emissao), EXTRACT(MONTH FROM p.data_emissao)
  ),
  despesa_psgc AS (SELECT company_id, ano, mes, SUM(valor) AS valor_psgc FROM psgc_dre WHERE regime='competencia' AND source='pr_4_5_re_etl_despesa' GROUP BY company_id, ano, mes),
  comparacao AS (
    SELECT r.company_id, r.ano, r.mes, r.valor_real, COALESCE(p.valor_psgc,0) AS valor_psgc, r.valor_real - COALESCE(p.valor_psgc,0) AS delta_abs,
           CASE WHEN r.valor_real>0 THEN ABS((r.valor_real - COALESCE(p.valor_psgc,0))/r.valor_real)*100 ELSE 0 END AS delta_pct
    FROM despesa_real r LEFT JOIN despesa_psgc p ON p.company_id=r.company_id AND p.ano=r.ano AND p.mes=r.mes
  )
  INSERT INTO erp_truth_alerts (rule_id, company_id, severity, area, tipo_divergencia, valor_esperado, valor_encontrado, delta_percentual, periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at)
  SELECT 'dre_despesas_bate_pagamentos', c.company_id,
    CASE WHEN c.delta_pct>10 OR ABS(c.delta_abs)>50000 THEN 'critical' WHEN c.delta_pct>5 OR ABS(c.delta_abs)>10000 THEN 'warn' ELSE 'info' END,
    'dre','despesa_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01'), (DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01')+INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo',c.ano||'-'||LPAD(c.mes::text,2,'0'),'valor_real_erp_pagar',c.valor_real,'valor_psgc_dre',c.valor_psgc,'delta_pct',ROUND(c.delta_pct::numeric,2)),
    CONCAT('Divergencia despesa R$ ',ROUND(ABS(c.delta_abs)::numeric,2),' (',ROUND(c.delta_pct::numeric,1),'%) ',c.ano,'-',LPAD(c.mes::text,2,'0')),
    CASE WHEN c.valor_psgc=0 THEN 'Re-executar PR 4.5 - psgc_dre despesa vazio para periodo' WHEN c.delta_pct>10 THEN 'Investigar gap mapeamento ou bug ETL despesa' ELSE 'Verificar transferencias/categorias atipicas em erp_pagar' END,
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_despesas_bate_pagamentos' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

REVOKE ALL ON FUNCTION public.fn_truth_audit_dre_despesa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_truth_audit_dre_despesa() TO authenticated, service_role;

-- ============================================================================
-- (2)+(3) Briefing: excluir empresas não-produtivas do clientes_ativos E do MRR.
--         Única mudança: WHERE ts.company_id IN (SELECT fn_empresas_produtivas()) no bloco 'comercial'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_briefing_sessao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_ultimo_handoff record;
  v_ultimo_snapshot record;
  v_truth_pendentes jsonb;
  v_insights_pendentes jsonb;
  v_telas_refacao jsonb;
  v_contrato_v1_ativo jsonb;
  v_saneamento jsonb;
  v_rd38_validacao_prs jsonb;
  v_rd38_rejeicoes_insight jsonb;
  v_rd38_falhas_playwright jsonb;
  v_rd38_falhas_cron jsonb;
BEGIN
  SELECT * INTO v_ultimo_handoff FROM erp_handoff_sessao ORDER BY criado_em DESC LIMIT 1;
  SELECT * INTO v_ultimo_snapshot FROM manual_vivo_diario ORDER BY hora_snapshot DESC LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('id',id,'severity',severity,'area',area,'tipo',tipo_divergencia,'mensagem',mensagem,'detected_at',detected_at,'recomendacao',recomendacao)) INTO v_truth_pendentes
  FROM (
    SELECT id,severity,area,tipo_divergencia,mensagem,detected_at,recomendacao FROM erp_truth_alerts
    WHERE status='novo' AND severity IN ('critical','high') AND (apresentado_ceo=false OR apresentado_ceo IS NULL)
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, detected_at DESC LIMIT 10
  ) t;

  SELECT jsonb_agg(jsonb_build_object('rota',rota,'score_evolucao_pct',score_evolucao_pct,'score_visual',score_visual,'bugs_visuais',bugs_visuais_detectados,'proximo_passo',proximo_passo_sugerido,'analisado_em',analisado_em)) INTO v_insights_pendentes
  FROM (
    SELECT rota,score_evolucao_pct,score_visual,bugs_visuais_detectados,proximo_passo_sugerido,analisado_em FROM system_screens_insights
    WHERE (apresentado_ceo=false OR apresentado_ceo IS NULL) AND (score_evolucao_pct<30 OR score_visual<30)
    ORDER BY score_evolucao_pct ASC NULLS LAST, analisado_em DESC LIMIT 5
  ) t;

  SELECT jsonb_agg(jsonb_build_object('rota_alvo',rota_alvo,'vezes_mexida_30d',vezes,'ultima_intervencao',ultima)) INTO v_telas_refacao
  FROM (
    SELECT rota_alvo,COUNT(*) as vezes,MAX(data_ref)::date as ultima FROM (
      SELECT
        CASE
          WHEN titulo ~* 'dashboard.?home|painel.geral|home/' THEN '/dashboard/home'
          WHEN titulo ~* 'analises|analise' THEN '/dashboard/analises'
          WHEN titulo ~* 'financeiro' THEN '/dashboard/financeiro'
          WHEN titulo ~* 'bpo' THEN '/dashboard/bpo'
          WHEN titulo ~* 'wealth' THEN '/dashboard/wealth'
          WHEN titulo ~* 'compliance' THEN '/dashboard/compliance'
          WHEN titulo ~* 'commerce' THEN '/dashboard/commerce'
          ELSE NULL
        END as rota_alvo,
        criado_em as data_ref
      FROM erp_contexto_projeto
      WHERE criado_em > NOW() - INTERVAL '30 days'
        AND categoria IN ('decisao','bug','descoberta','arquitetura')
        AND (titulo ~* 'dashboard|home|painel|reenquadramento|refactor|redesign|fix|hotfix' OR tags && ARRAY['refactor','reenquadramento','redesign'])
    ) base WHERE rota_alvo IS NOT NULL GROUP BY rota_alvo HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC
  ) t;

  v_contrato_v1_ativo := jsonb_build_object(
    'contrato_v1_vigente', true,
    'id_contexto', 'dfe6e08f-bbb3-4a37-b3bd-803f120d2d29',
    'aviso', 'Contrato V1 ativo. CEO interrompe citando Contrato item X.',
    'protocolo_obrigatorio', 'Síntese 3 linhas após briefing (Seção 1.5)'
  );

  SELECT row_to_json(v.*)::jsonb INTO v_saneamento FROM v_saneamento_estado v LIMIT 1;

  -- RD-38: validacao PRs
  v_rd38_validacao_prs := fn_rd38_prs_pendentes_validacao(72);

  -- RD-38: rejeicoes Insight Auditor
  SELECT jsonb_build_object(
    'total_24h', (SELECT COUNT(*) FROM rd38_insight_rejeicoes WHERE detectado_em > NOW() - INTERVAL '24 hours'),
    'pendentes', (SELECT COUNT(*) FROM rd38_insight_rejeicoes WHERE status = 'novo'),
    'ultimas_5', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'request_id', request_id_origem, 'detectado_em', detectado_em,
        'mensagem', mensagem_rejeicao, 'count', count_retornado, 'status', status
      ) ORDER BY detectado_em DESC)
      FROM (SELECT * FROM rd38_insight_rejeicoes ORDER BY detectado_em DESC LIMIT 5) t
    ), '[]'::jsonb)
  ) INTO v_rd38_rejeicoes_insight;

  -- RD-38 NOVO: falhas Playwright
  SELECT jsonb_build_object(
    'total_24h', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE detectado_em > NOW() - INTERVAL '24 hours'),
    'pendentes', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE status = 'novo'),
    'throttle_vercel', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE status = 'throttle_vercel'),
    'tipos_erro', COALESCE((
      SELECT jsonb_object_agg(tipo_erro, qtd) FROM (
        SELECT tipo_erro, COUNT(*) AS qtd FROM rd38_playwright_falhas
        WHERE detectado_em > NOW() - INTERVAL '24 hours'
        GROUP BY tipo_erro
      ) t
    ), '{}'::jsonb)
  ) INTO v_rd38_falhas_playwright;

  -- RD-38 NOVO: falhas cron
  SELECT jsonb_build_object(
    'total_1h', (SELECT COUNT(*) FROM rd38_cron_falhas WHERE detectado_em > NOW() - INTERVAL '1 hour'),
    'pendentes', (SELECT COUNT(*) FROM rd38_cron_falhas WHERE status = 'novo'),
    'jobs_quebrados', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'jobname', jobname,
        'qtd_falhas', qtd,
        'tipo_erro', tipo_erro,
        'falhas_consecutivas', max_consec
      ) ORDER BY qtd DESC)
      FROM (
        SELECT jobname, tipo_erro, COUNT(*) AS qtd, MAX(falhas_consecutivas) AS max_consec
        FROM rd38_cron_falhas
        WHERE detectado_em > NOW() - INTERVAL '1 hour'
        GROUP BY jobname, tipo_erro
      ) t
    ), '[]'::jsonb)
  ) INTO v_rd38_falhas_cron;

  v_result := jsonb_build_object(
    'momento', NOW(),
    'aviso_rd35', 'RD-35 + CONTRATO V1 + PLANO SANEAMENTO V1 + RD-38 + RD-39 INEGOCIAVEIS.',
    'contrato_v1', v_contrato_v1_ativo,
    'plano_saneamento_v1', v_saneamento,

    'rd38_doutrina_verdade_absoluta', jsonb_build_object(
      'vigente_desde', '24/05/2026',
      'principio_raiz', 'Engenheiro Chefe NUNCA pode declarar entrega validada baseado em ausencia de evidencia negativa. Verdade absoluta exige confronto entre PROMETIDO vs REAL.',
      'bloqueio_ativo', 'Nenhum PR feature pode ser declarado validado sem CEO confirmar empiricamente · ate Camada 1 estar em producao',
      'camadas_status', jsonb_build_object(
        'camada_1_url_final_visitada', 'pendente_pr_repo',
        'camada_2_fn_validar_entrega_pr', 'v1_manual_em_producao',
        'camada_3_insight_nao_silent', 'em_producao',
        'camada_3_expandida_playwright_falhas', 'em_producao',
        'camada_3_estendida_cron_falhas', 'em_producao',
        'camada_4_briefing_entregas', 'em_producao'
      ),
      'validacao_prs_72h', v_rd38_validacao_prs,
      'rejeicoes_insight', v_rd38_rejeicoes_insight,
      'falhas_playwright', v_rd38_falhas_playwright,
      'falhas_cron', v_rd38_falhas_cron
    ),

    'alertas_pendentes_para_ceo', jsonb_build_object(
      'truth_alerts_criticos', COALESCE(v_truth_pendentes,'[]'::jsonb),
      'truth_alerts_total_pendentes', (SELECT COUNT(*) FROM erp_truth_alerts WHERE status='novo' AND severity IN ('critical','high')),
      'insights_ui_criticos', COALESCE(v_insights_pendentes,'[]'::jsonb),
      'insights_ui_total_pendentes', (SELECT COUNT(*) FROM system_screens_insights WHERE (apresentado_ceo=false OR apresentado_ceo IS NULL) AND (score_evolucao_pct<30 OR score_visual<30)),
      'telas_em_loop_refacao', COALESCE(v_telas_refacao,'[]'::jsonb),
      'instrucao_claude', 'OBRIGATORIO Secao 1.5 Contrato V1 + DECLARAR Fase atual Saneamento + RD-38 verificar entregas pendentes + falhas Playwright/cron'
    ),
    'estrela_polar_resumo', jsonb_build_object(
      'aviso', 'Secoes 1, 2, 6, 7, 8 + Secao 9 Contrato V1 + Secao 10 Saneamento V1 + Regra 35 + RD-38 + RD-39',
      'secao_1_visao', jsonb_build_object('versao','V1.7','planos_total',12,'lancamento_erp_completo','2027-05'),
      'secao_2_regras', jsonb_build_object('regra_34','Eficiencia + Integridade + Velocidade','regra_35','IPO obrigatoria 4 fontes','regra_38','Doutrina Verdade Absoluta','regra_39','Zero Handoff'),
      'secao_6_comunicacao', jsonb_build_object('versao','V1.1','filtro_7_itens',ARRAY['Land/Expand/Replace','Foundational 10K','ERP 2027','Camada arquitetural','Legal','LGPD','UX mobile-first']),
      'secao_7_autonomia', jsonb_build_object('5_cenarios','A executa+reporta / B executa+justifica / C 6 grupos protegidos PARA / D alerta violacao / E para+pergunta'),
      'secao_8_olhos_maos', jsonb_build_object('fase_a','Visual Truth Auditor em construcao'),
      'secao_9_contrato_v1', jsonb_build_object('vigente_desde','16/05/2026','protocolo','sintese 3 linhas obrigatoria + anti-refacao'),
      'secao_10_saneamento_v1', jsonb_build_object('vigente_desde','16/05/2026','fases_sequenciais',true,'conclusao_estimada','13/06/2026'),
      'regra_35_ipo', jsonb_build_object('versao','V1.0','gatilhos',ARRAY['cliente operando','pacote >2h','CEO sinaliza','404/erro']),
      'regra_38_verdade_absoluta', jsonb_build_object('versao','V1.0','vigente_desde','24/05/2026','camadas',4),
      'regra_39_zero_handoff', jsonb_build_object('versao','V1.0','vigente_desde','24/05/2026','principio','Eng Chefe NUNCA propoe pausa')
    ),
    'checklist_obrigatoria_claude', jsonb_build_object(
      'itens', ARRAY[
        '1. Li resumo Estrela Polar?',
        '2. Apliquei Filtro 7 itens?',
        '3. Qual Cenario Sec 7?',
        '4. Toca 6 Grupos Protegidos?',
        '5. Avaliei Regra #34?',
        '6. Vou cristalizar?',
        '7. Gatilhos Regra #35 IPO?',
        '8. Visual_truth alertas?',
        '9. ⭐ CONTRATO V1: sintese 3 linhas (Sec 1.5)?',
        '10. ⭐ CONTRATO V1: rota em LOOP DE REFACAO? Justificar?',
        '11. 🛑 SANEAMENTO V1: estamos em qual Fase? Minha proposta cabe na Fase atual?',
        '12. 🛑 SANEAMENTO V1: meu PR cita "Fase X.Y" no body?',
        '13. 🛑 SANEAMENTO V1: feature NOVA está proibida (exceto Fase 4)?',
        '14. 🛡️ RD-38: PR mergeado validado empiricamente pelo CEO ou apenas via auditor (potencial falso-positivo)?',
        '15. 🛡️ RD-39: ZERO handoff · NUNCA propor pausa',
        '16. 🛡️ RD-38: Falhas Playwright/cron pendentes? Verificar bloco rd38_doutrina_verdade_absoluta no briefing'
      ]
    ),
    'ultimo_handoff', CASE WHEN v_ultimo_handoff.id IS NOT NULL THEN jsonb_build_object('sessao_data',v_ultimo_handoff.sessao_data,'ha_horas',EXTRACT(EPOCH FROM (NOW()-v_ultimo_handoff.criado_em))::int/3600,'ultima_acao',v_ultimo_handoff.ultima_acao,'ultimo_pr',v_ultimo_handoff.ultimo_pr,'proxima_acao_recomendada',v_ultimo_handoff.proxima_acao_recomendada,'alertas_criticos',v_ultimo_handoff.alertas_criticos) ELSE jsonb_build_object('aviso','PRIMEIRA SESSAO') END,
    'visual_truth', fn_visual_truth_resumo(),
    'manual_vivo_ultimo_snapshot', CASE WHEN v_ultimo_snapshot.id IS NOT NULL THEN jsonb_build_object('data',v_ultimo_snapshot.data_snapshot,'pct_evolucao_geral',v_ultimo_snapshot.pct_evolucao_geral,'rotas_404',v_ultimo_snapshot.rotas_404_confirmadas,'telas_score_critico',v_ultimo_snapshot.telas_score_critico) ELSE jsonb_build_object('aviso','sem snapshot') END,
    'empresas_resumo', (SELECT jsonb_build_object('total',COUNT(*),'ativas',COUNT(*) FILTER (WHERE is_active=true),'nota','produção; demos e sandboxes fora') FROM companies_producao),
    'comercial', (SELECT jsonb_build_object('clientes_ativos',COUNT(*) FILTER (WHERE ts.status='active'),'mrr_total_brl',COALESCE(SUM(ts.monthly_price_brl) FILTER (WHERE ts.status='active'),0)) FROM tenant_subscriptions ts JOIN plan_catalog pc ON pc.id=ts.plan_id AND pc.legacy=false WHERE ts.company_id IN (SELECT fn_empresas_produtivas())),
    'auditores_status', (SELECT jsonb_agg(jsonb_build_object('jobname',jobname,'active',active)) FROM cron.job WHERE jobname LIKE '%auditor%' OR jobname LIKE '%watcher%' OR jobname LIKE '%insight%' OR jobname LIKE '%manual_vivo%' OR jobname LIKE '%playwright%')
  );

  v_result := v_result || jsonb_build_object('fluxo_trabalho_oficial_RD41', fn_fluxo_trabalho_oficial());
  v_result := v_result || jsonb_build_object(
    'estado_construcao_ge', (
      SELECT jsonb_build_object(
        'trilha', 'GE · Rodar como ContaAzul (custo zero)',
        'blocos_total', COUNT(*),
        'blocos_concluidos', COUNT(*) FILTER (WHERE status = 'concluido'),
        'pct', CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE status='concluido')/COUNT(*)) ELSE 0 END,
        'proximo_bloco', (SELECT titulo FROM erp_roadmap_marcos WHERE trilha_nome = 'GE · Rodar como ContaAzul (custo zero)' AND status != 'concluido' ORDER BY ordem_na_trilha LIMIT 1),
        'como_marcar_avanco', 'SELECT fn_registrar_avanco_ge(marco_id, pr, print_url, veredito_gold, nota)'
      )
      FROM erp_roadmap_marcos
      WHERE trilha_nome = 'GE · Rodar como ContaAzul (custo zero)'
    )
  );

  -- ADITIVO (RD-52): fontes externas para a próxima Claude — verdade do coletor ATAK/Frioeste no briefing.
  v_result := v_result || jsonb_build_object('fontes_externas', jsonb_build_object('atak', public.fn_atak_status()));

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO authenticated, service_role;

-- ============================================================================
-- (2)+DRE seed · fn_demo_seed_ge_dre: assinatura v15_gestao_empresarial_pro a R$0 (idempotente)
--     + recálculo REAL do DRE dos últimos 6 meses (competência + caixa) para a demo 004.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_dre(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  v_mes date;
  v_ini date := date_trunc('month', CURRENT_DATE) - INTERVAL '5 months';
  v_meses int := 0;
  v_linhas_dre int;
  v_sub_existe boolean;
BEGIN
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- Assinatura v15_gestao_empresarial_pro a R$0 (a demo aparece como tenant GE Pró; MRR real intacto).
  -- Idempotente: só cria se ainda não houver assinatura ativa desse plano para a demo.
  SELECT EXISTS(
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro'
  ) INTO v_sub_existe;
  IF NOT v_sub_existe THEN
    INSERT INTO tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, created_by)
    VALUES (p_company_id, 'v15_gestao_empresarial_pro', 'active', 0, 'monthly', 'pro', auth.uid());
  ELSE
    UPDATE tenant_subscriptions
      SET status = 'active', monthly_price_brl = 0
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro';
  END IF;

  -- DRE dos últimos 6 meses pelo caminho REAL (competência via emissão + caixa via pagamento).
  v_mes := v_ini;
  WHILE v_mes <= date_trunc('month', CURRENT_DATE) LOOP
    PERFORM public.fn_psgc_recalcular_dre_mes(
      p_company_id,
      EXTRACT(YEAR FROM v_mes)::int,
      EXTRACT(MONTH FROM v_mes)::int
    );
    v_meses := v_meses + 1;
    v_mes := (v_mes + INTERVAL '1 month')::date;
  END LOOP;

  SELECT COUNT(*)::int INTO v_linhas_dre FROM psgc_dre WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'assinatura', 'v15_gestao_empresarial_pro@R$0',
    'meses_recalculados', v_meses,
    'linhas_psgc_dre', v_linhas_dre
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_dre(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_dre(uuid) TO authenticated, service_role;

-- ============================================================================
-- Encadear o Bloco 6 (DRE) no fn_demo_reset da demo GE (004).
--     Única mudança: acrescentar v_dre no ramo da 004.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
