-- RD-38 — o ledger (briefing do CEO) não pode mentir. As regras truth de DRE geram CRÍTICOS FALSOS.
-- Auditor auditor_pdca_2 provou NO DADO (empresas REAIS Tryo/Umuarama, is_demo=false) que as duas regras
-- 'dre_receita_bate_nfs' (fn_truth_audit_dre) e 'dre_despesas_bate_pagamentos' (fn_truth_audit_dre_despesa)
-- comparam base INVÁLIDA e disparam centenas de 'critical' que entram no briefing do CEO
-- (fn_briefing_sessao -> alertas_pendentes_para_ceo.truth_alerts_criticos, severity IN ('critical','high')).
-- A TELA DRE (/dashboard/financeiro/dre-consolidado via psgc_dre, regime-filtrado) está CORRETA.
--
-- Por que a base é inválida (resumo da prova RD-38):
--  - "esperado" soma erp_receber/erp_pagar por MÊS de data_EMISSAO, escopo amplo (sem filtrar
--    deleted/cancelado/transferência e sem restringir às categorias do DRE).
--  - "encontrado" soma psgc_dre por MÊS de COMPETÊNCIA, escopo ROB (receita) / grupos de despesa.
--  - Dois eixos de data (emissão × competência) + escopos diferentes -> divergência artificial
--    (ex.: Tryo 2026-08 "esperado" R$ 61,5M ≈ total de TODOS os períodos; Umuarama despesa diverge
--    até +968% no mês). Não é tela-x-fonte real.
--
-- O QUE ESTE PR FAZ (conservador, reversível — opção (c) do auditor, "reconciliação informativa até
-- alinhar"): REBAIXA as DUAS regras para NO MÁXIMO 'warn' (nunca 'critical'), então saem do briefing do
-- CEO, mas continuam VISÍVEIS como reconciliação informativa (nada é apagado nem escondido). A lógica de
-- comparação fica intacta: uma divergência grande ainda aparece como 'warn' — não mascara nada.
-- O realinhamento like-for-like (mesmo eixo de data e escopo nos dois lados) exige prova em cópia local
-- (detector varre todas as empresas produtivas; incidente 03/10 proíbe prova pesada em produção) e fica
-- como tarefa seguinte. NÃO afrouxa truth real: o alvo é não declarar CRÍTICO o que é base inválida.
-- Code: code-desenvolvedor-3

-- 1) RECEITA — fn_truth_audit_dre: severity capada em 'warn' (remove o ramo 'critical') ----------------
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
    -- [RD-38 2026-11-11] base de comparação em revisão (emissão×competência + escopo) -> nunca 'critical'.
    CASE WHEN c.delta_pct>5 OR ABS(c.delta_abs)>10000 THEN 'warn' ELSE 'info' END,
    'dre','receita_bruta_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01'), (DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01')+INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo',c.ano||'-'||LPAD(c.mes::text,2,'0'),'valor_real_erp_receber',c.valor_real,'valor_psgc_dre',c.valor_psgc,'delta_pct',ROUND(c.delta_pct::numeric,2),'base','reconciliacao_informativa_em_revisao'),
    CONCAT('Reconciliacao receita (informativa) R$ ',ROUND(ABS(c.delta_abs)::numeric,2),' (',ROUND(c.delta_pct::numeric,1),'%) na receita ',c.ano,'-',LPAD(c.mes::text,2,'0')),
    'Reconciliacao informativa: erp_receber (emissao, escopo amplo) x psgc_dre ROB (competencia). Eixo de data e escopo em alinhamento; nao e divergencia tela-x-fonte (a tela DRE le psgc_dre).',
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_receita_bate_nfs' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;
-- detector interno (cron/serviço); nunca chamável por quem não está logado.
REVOKE ALL ON FUNCTION public.fn_truth_audit_dre() FROM anon, public;

-- 2) DESPESA — fn_truth_audit_dre_despesa: severity capada em 'warn' (remove o ramo 'critical') --------
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
    -- [RD-38 2026-11-11] base de comparação em revisão (emissão×competência + escopo) -> nunca 'critical'.
    CASE WHEN c.delta_pct>5 OR ABS(c.delta_abs)>10000 THEN 'warn' ELSE 'info' END,
    'dre','despesa_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01'), (DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01')+INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo',c.ano||'-'||LPAD(c.mes::text,2,'0'),'valor_real_erp_pagar',c.valor_real,'valor_psgc_dre',c.valor_psgc,'delta_pct',ROUND(c.delta_pct::numeric,2),'base','reconciliacao_informativa_em_revisao'),
    CONCAT('Reconciliacao despesa (informativa) R$ ',ROUND(ABS(c.delta_abs)::numeric,2),' (',ROUND(c.delta_pct::numeric,1),'%) ',c.ano,'-',LPAD(c.mes::text,2,'0')),
    'Reconciliacao informativa: erp_pagar (emissao, escopo amplo) x psgc_dre despesa (competencia). Eixo de data e escopo em alinhamento; nao e divergencia tela-x-fonte (a tela DRE le psgc_dre).',
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_despesas_bate_pagamentos' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;
-- detector interno (cron/serviço); nunca chamável por quem não está logado.
REVOKE ALL ON FUNCTION public.fn_truth_audit_dre_despesa() FROM anon, public;

-- 3) Limpeza imediata (bounded, WITH WHERE, tabela de sistema não-domínio): rebaixa os CRÍTICOS FALSOS
-- já existentes dessas duas regras para 'warn', tirando-os do briefing do CEO SEM re-rodar o detector
-- (que varre todas as empresas produtivas — proibido em produção pelo incidente 03/10). A próxima
-- execução do detector já grava direto em 'warn'. Nada é apagado; nenhuma outra regra é tocada.
UPDATE public.erp_truth_alerts
   SET severity = 'warn'
 WHERE rule_id IN ('dre_receita_bate_nfs','dre_despesas_bate_pagamentos')
   AND status = 'novo'
   AND severity = 'critical';
