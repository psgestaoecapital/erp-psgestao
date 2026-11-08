-- NÚCLEO/TRUTH (PDCA GE · auditor_pdca_2 / RD-38) · 2026-11-08 · Code: code-desenvolvedor-3
-- BUG: fn_truth_audit_dre e fn_truth_audit_dre_despesa liam o lado "encontrado" de psgc_dre com um
-- filtro de SOURCE que NÃO EXISTE MAIS em regime='competencia':
--   receita: source='pr_4_4_re_etl_receita'  -> hoje só existe em regime='caixa' (3 linhas)
--   despesa: source='pr_4_5_re_etl_despesa'   -> hoje só existe em regime='caixa' (1 linha)
-- Resultado: valor_encontrado = 0 para TODAS as empresas => 600 alertas CRÍTICOS FALSOS (delta 100%),
-- que poluem o fn_briefing_sessao do CEO (truth_alerts_criticos) e podem MASCARAR divergência real.
--
-- PROVA RD-38 (produção, 2026-11-08):
--   Gean (a462e13f...) 2026-08 Receita Operacional Bruta:
--     fn_psgc_dre_consolidada -> 131.026,30  |  lado "encontrado" ATUAL (source stale) -> 0,00
--     lado "encontrado" NOVO (dre_grupo='ROB') -> 131.026,30  (== a tela)
--   distinct sources de psgc_dre: 'pr_4_4_re_etl_receita'/'pr_4_5_re_etl_despesa' só em regime='caixa';
--   receita de competência vem de etl_receber/etl_receber_direto; despesa de etl_pagar_omie/etl_pagar_direto.
--
-- CORREÇÃO: ler o "encontrado" pela MESMA definição que a tela (fn_psgc_dre_consolidada), via
-- JOIN psgc_contas e dre_grupo, em regime de competência — nunca por um nome de ETL que mudou:
--   receita  -> dre_grupo = 'ROB'
--   despesa  -> dre_grupo NOT IN ('ROB','NEUTRO')  (todos os grupos de despesa do DRE)
--
-- EFEITO MEDIDO (simulação read-only, todas as empresas produtivas):
--   receita: 299 críticos (found=0) -> 98 críticos reais + 14 sem ROB no período
--   despesa: 301 críticos (found=0) -> 77 críticos reais + 12 sem despesa no período
--   total de CRÍTICOS: 600 -> 175, e os 175 restantes são COMPARAÇÕES REAIS (não mais "found 0").
--   NÃO forço os residuais a sumir (RD-38): são divergências reais erp_receber/erp_pagar × DRE
--   (base de período data_emissao × competência; e payables incluem itens fora do P&L) a triar pelo auditor.
--
-- Sem mudança de cálculo/contrato/retorno, de severidade/limiar, nem de dado de cliente. Só o lado "encontrado".
-- O cron truth-auditor-dre-1h (minuto 5, fn_truth_audit_executar_todas) re-executa e auto-cura em <=1h:
-- cada função faz DELETE dos alertas novo/ignorado e re-INSERT dos corretos.

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
  receita_psgc AS (
    -- [fix 2026-11-08] "encontrado" = Receita Operacional Bruta do DRE (igual fn_psgc_dre_consolidada),
    -- lida por dre_grupo='ROB' em competência. Antes: source='pr_4_4_re_etl_receita' (ETL morto -> 0).
    SELECT d.company_id, d.ano, d.mes, SUM(d.valor) AS valor_psgc
    FROM psgc_dre d
    JOIN psgc_contas c ON c.codigo = d.psgc_codigo
    WHERE COALESCE(d.regime,'competencia') = 'competencia' AND c.dre_grupo = 'ROB'
    GROUP BY d.company_id, d.ano, d.mes
  ),
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
    CASE WHEN c.valor_psgc=0 THEN 'DRE sem receita (ROB) no periodo - verificar ETL psgc_dre' WHEN c.delta_pct>10 THEN 'Investigar divergencia critica' WHEN c.delta_pct>1 THEN 'Verificar transferencias/vendas-ativos em erp_receber' ELSE 'Diferenca menor que 1% - tolerancia' END,
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_receita_bate_nfs' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- Auditoria do Truth: rodada só pelo cron (service_role). Nunca exposta a anon/authenticated.
REVOKE ALL ON FUNCTION public.fn_truth_audit_dre() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_truth_audit_dre() TO service_role;

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
  despesa_psgc AS (
    -- [fix 2026-11-08] "encontrado" = despesa do DRE (todos os grupos de despesa, igual fn_psgc_dre_consolidada),
    -- lida por dre_grupo em competência. Antes: source='pr_4_5_re_etl_despesa' (ETL morto -> 0).
    SELECT d.company_id, d.ano, d.mes, SUM(d.valor) AS valor_psgc
    FROM psgc_dre d
    JOIN psgc_contas c ON c.codigo = d.psgc_codigo
    WHERE COALESCE(d.regime,'competencia') = 'competencia' AND c.dre_grupo NOT IN ('ROB','NEUTRO')
    GROUP BY d.company_id, d.ano, d.mes
  ),
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
    CASE WHEN c.valor_psgc=0 THEN 'DRE sem despesa no periodo - verificar ETL psgc_dre' WHEN c.delta_pct>10 THEN 'Investigar gap mapeamento ou bug ETL despesa' ELSE 'Verificar transferencias/categorias atipicas em erp_pagar' END,
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_despesas_bate_pagamentos' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- Auditoria do Truth: rodada só pelo cron (service_role). Nunca exposta a anon/authenticated.
REVOKE ALL ON FUNCTION public.fn_truth_audit_dre_despesa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_truth_audit_dre_despesa() TO service_role;
