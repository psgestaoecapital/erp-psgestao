-- ============================================================
-- erp_truth_alerts — parar a bomba de duplicata (Opção B, aprovada CEO).
-- Diagnóstico: 554.194 linhas · 535 grupos únicos · 99,9% duplicata.
-- Causa: as 5 sub-funções de auditoria (cron horário jobid 28) rebaixavam os
-- alertas anteriores a status='ignorado' e RE-INSERIAM cópias novas toda hora,
-- empilhando o histórico. Fix: cada sub-função DELETA seus alertas-MÁQUINA
-- (status novo/ignorado) da própria regra ANTES de reinserir → tabela se
-- auto-mantém em ~N linhas úteis, sem índice único / ON CONFLICT / problema de NULL.
-- Preserva SEMPRE status humano (resolvido/investigando/falso_positivo).
-- Sem mudar severity (a escala já é correta) nem o cron (só fica idempotente).
-- ============================================================

-- 1) BACKUP de segurança antes de qualquer DELETE (dropar só após CEO validar).
CREATE TABLE IF NOT EXISTS erp_truth_alerts_bkp_20260711 AS
SELECT * FROM erp_truth_alerts;

-- 2) EXPURGO KEEP-1 do backlog: mantém a linha MÁQUINA mais recente por grupo
--    (rule_id, company_id, periodo_inicio, periodo_fim — COALESCE p/ tratar NULL
--    das linhas sync_omie/links_404 como mesma chave). NÃO toca status humano.
DELETE FROM erp_truth_alerts
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY
               COALESCE(rule_id, tipo_divergencia, ''),
               COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(periodo_inicio, DATE '0001-01-01'),
               COALESCE(periodo_fim,    DATE '0001-01-01')
             ORDER BY COALESCE(detected_at, created_at) DESC NULLS LAST, id DESC
           ) AS rn
    FROM erp_truth_alerts
    WHERE status IN ('novo','ignorado')      -- SALVAGUARDA: só linhas-máquina
  ) t
  WHERE t.rn > 1
);

-- 3) SUB-FUNÇÕES idempotentes: troca "UPDATE->ignorado" por "DELETE máquina da regra"
--    (dre / dre_despesa / compras), e ADICIONA o DELETE nas que não tinham
--    (saldo_unificado / links_404). Corpo idêntico ao atual salvo esse passo.

-- 3.1 — Receita (dre_receita_bate_nfs)
CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  -- IDEMPOTENTE: apaga os alertas-máquina desta regra antes de reinserir (preserva status humano)
  DELETE FROM erp_truth_alerts
  WHERE rule_id = 'dre_receita_bate_nfs' AND status IN ('novo','ignorado');

  WITH receita_real AS (
    SELECT r.company_id, EXTRACT(YEAR FROM r.data_emissao)::int AS ano,
           EXTRACT(MONTH FROM r.data_emissao)::int AS mes, SUM(r.valor) AS valor_real
    FROM erp_receber r
    WHERE r.valor > 0 AND r.data_emissao IS NOT NULL
    GROUP BY r.company_id, EXTRACT(YEAR FROM r.data_emissao), EXTRACT(MONTH FROM r.data_emissao)
  ),
  receita_psgc AS (
    SELECT company_id, ano, mes, SUM(valor) AS valor_psgc
    FROM psgc_dre WHERE regime = 'competencia' AND source = 'pr_4_4_re_etl_receita'
    GROUP BY company_id, ano, mes
  ),
  comparacao AS (
    SELECT r.company_id, r.ano, r.mes, r.valor_real, COALESCE(p.valor_psgc, 0) AS valor_psgc,
           r.valor_real - COALESCE(p.valor_psgc, 0) AS delta_abs,
           CASE WHEN r.valor_real > 0 THEN ABS((r.valor_real - COALESCE(p.valor_psgc, 0)) / r.valor_real) * 100 ELSE 0 END AS delta_pct
    FROM receita_real r
    LEFT JOIN receita_psgc p ON p.company_id = r.company_id AND p.ano = r.ano AND p.mes = r.mes
  )
  INSERT INTO erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia,
    valor_esperado, valor_encontrado, delta_percentual,
    periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at
  )
  SELECT 'dre_receita_bate_nfs', c.company_id,
    CASE WHEN c.delta_pct > 10 OR ABS(c.delta_abs) > 50000 THEN 'critical'
         WHEN c.delta_pct > 5 OR ABS(c.delta_abs) > 10000 THEN 'warn' ELSE 'info' END,
    'dre', 'receita_bruta_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01'),
    (DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01') + INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo', c.ano || '-' || LPAD(c.mes::text, 2, '0'),
      'valor_real_erp_receber', c.valor_real, 'valor_psgc_dre', c.valor_psgc,
      'delta_pct', ROUND(c.delta_pct::numeric, 2)),
    CONCAT('Divergencia R$ ', ROUND(ABS(c.delta_abs)::numeric, 2), ' (', ROUND(c.delta_pct::numeric, 1), '%) na receita ', c.ano, '-', LPAD(c.mes::text, 2, '0')),
    CASE WHEN c.valor_psgc = 0 THEN 'Re-executar PR 4.4 - psgc_dre vazio'
         WHEN c.delta_pct > 10 THEN 'Investigar divergencia critica'
         WHEN c.delta_pct > 1 THEN 'Verificar transferencias/vendas-ativos em erp_receber'
         ELSE 'Diferenca menor que 1% - tolerancia' END,
    'novo', NOW()
  FROM comparacao c
  WHERE ABS(c.delta_pct) > 1 OR ABS(c.delta_abs) > 1000;

  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity = 'critical')
    INTO v_empresas, v_criticas
  FROM erp_truth_alerts WHERE rule_id = 'dre_receita_bate_nfs' AND status = 'novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- 3.2 — Despesa (dre_despesas_bate_pagamentos)
CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre_despesa()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  DELETE FROM erp_truth_alerts
  WHERE rule_id = 'dre_despesas_bate_pagamentos' AND status IN ('novo','ignorado');

  WITH despesa_real AS (
    SELECT p.company_id, EXTRACT(YEAR FROM p.data_emissao)::int AS ano,
           EXTRACT(MONTH FROM p.data_emissao)::int AS mes, SUM(p.valor) AS valor_real
    FROM erp_pagar p WHERE p.valor > 0 AND p.data_emissao IS NOT NULL
    GROUP BY p.company_id, EXTRACT(YEAR FROM p.data_emissao), EXTRACT(MONTH FROM p.data_emissao)
  ),
  despesa_psgc AS (
    SELECT company_id, ano, mes, SUM(valor) AS valor_psgc
    FROM psgc_dre WHERE regime = 'competencia' AND source = 'pr_4_5_re_etl_despesa'
    GROUP BY company_id, ano, mes
  ),
  comparacao AS (
    SELECT r.company_id, r.ano, r.mes, r.valor_real, COALESCE(p.valor_psgc, 0) AS valor_psgc,
           r.valor_real - COALESCE(p.valor_psgc, 0) AS delta_abs,
           CASE WHEN r.valor_real > 0 THEN ABS((r.valor_real - COALESCE(p.valor_psgc, 0)) / r.valor_real) * 100 ELSE 0 END AS delta_pct
    FROM despesa_real r
    LEFT JOIN despesa_psgc p ON p.company_id = r.company_id AND p.ano = r.ano AND p.mes = r.mes
  )
  INSERT INTO erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia,
    valor_esperado, valor_encontrado, delta_percentual,
    periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at
  )
  SELECT 'dre_despesas_bate_pagamentos', c.company_id,
    CASE WHEN c.delta_pct > 10 OR ABS(c.delta_abs) > 50000 THEN 'critical'
         WHEN c.delta_pct > 5 OR ABS(c.delta_abs) > 10000 THEN 'warn' ELSE 'info' END,
    'dre', 'despesa_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01'),
    (DATE(c.ano || '-' || LPAD(c.mes::text, 2, '0') || '-01') + INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo', c.ano || '-' || LPAD(c.mes::text, 2, '0'),
      'valor_real_erp_pagar', c.valor_real, 'valor_psgc_dre', c.valor_psgc,
      'delta_pct', ROUND(c.delta_pct::numeric, 2)),
    CONCAT('Divergencia despesa R$ ', ROUND(ABS(c.delta_abs)::numeric, 2), ' (', ROUND(c.delta_pct::numeric, 1), '%) ', c.ano, '-', LPAD(c.mes::text, 2, '0')),
    CASE WHEN c.valor_psgc = 0 THEN 'Re-executar PR 4.5 - psgc_dre despesa vazio para periodo'
         WHEN c.delta_pct > 10 THEN 'Investigar gap mapeamento ou bug ETL despesa'
         ELSE 'Verificar transferencias/categorias atipicas em erp_pagar' END,
    'novo', NOW()
  FROM comparacao c
  WHERE ABS(c.delta_pct) > 1 OR ABS(c.delta_abs) > 1000;

  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity = 'critical')
    INTO v_empresas, v_criticas
  FROM erp_truth_alerts WHERE rule_id = 'dre_despesas_bate_pagamentos' AND status = 'novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- 3.3 — Compras (compras_nf_entrada_vinculada)
CREATE OR REPLACE FUNCTION public.fn_truth_audit_compras()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  DELETE FROM erp_truth_alerts
  WHERE rule_id = 'compras_nf_entrada_vinculada' AND status IN ('novo','ignorado');

  WITH compras_sem_nf AS (
    SELECT c.company_id, EXTRACT(YEAR FROM c.data_pedido)::int AS ano,
           EXTRACT(MONTH FROM c.data_pedido)::int AS mes,
           COUNT(*) AS qtd_compras_sem_nf, SUM(c.total) AS valor_total
    FROM erp_compras c
    WHERE c.total > 100 AND (c.nf_numero IS NULL OR c.nf_numero = '' OR c.nf_numero = '-') AND c.data_pedido IS NOT NULL
    GROUP BY c.company_id, EXTRACT(YEAR FROM c.data_pedido), EXTRACT(MONTH FROM c.data_pedido)
  )
  INSERT INTO erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia,
    valor_esperado, valor_encontrado, delta_percentual,
    periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at
  )
  SELECT 'compras_nf_entrada_vinculada', cn.company_id,
    CASE WHEN cn.valor_total > 50000 THEN 'critical' WHEN cn.valor_total > 10000 THEN 'warn' ELSE 'info' END,
    'compras', 'compra_sem_nf', cn.valor_total, 0, 100,
    DATE(cn.ano || '-' || LPAD(cn.mes::text, 2, '0') || '-01'),
    (DATE(cn.ano || '-' || LPAD(cn.mes::text, 2, '0') || '-01') + INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo', cn.ano || '-' || LPAD(cn.mes::text, 2, '0'),
      'qtd_compras_sem_nf', cn.qtd_compras_sem_nf, 'valor_total_R$', cn.valor_total),
    CONCAT(cn.qtd_compras_sem_nf, ' compras sem NF totalizam R$ ', ROUND(cn.valor_total::numeric, 2), ' em ', cn.ano, '-', LPAD(cn.mes::text, 2, '0')),
    'Regularizar emissao/anexacao de NF para essas compras (compliance fiscal)',
    'novo', NOW()
  FROM compras_sem_nf cn;

  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity = 'critical')
    INTO v_empresas, v_criticas
  FROM erp_truth_alerts WHERE rule_id = 'compras_nf_entrada_vinculada' AND status = 'novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- 3.4 — Saldo unificado: NÃO tinha demote → adiciona DELETE-máquina da regra.
CREATE OR REPLACE FUNCTION public.fn_truth_audit_saldo_unificado()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rule_id uuid; v_alertas int := 0; v_empresas int := 0; v_divergencias int := 0;
  r_empresa record; v_saldo_helper numeric; v_saldo_contas_resumo numeric;
BEGIN
  SELECT id INTO v_rule_id FROM truth_audit_rules WHERE nome = 'saldo_rpcs_divergem_v2' AND ativo = true LIMIT 1;
  IF v_rule_id IS NULL THEN
    INSERT INTO truth_audit_rules (id, nome, descricao, area, severity_when_violated, check_type, ativo, frequencia)
    VALUES (gen_random_uuid(), 'saldo_rpcs_divergem_v2',
      'Saldo divergente entre fn_saldo_bancos_dinamico V2 e fn_ge_contas_resumo',
      'financeiro', 'warn', 'matematico', true, 'hourly')
    RETURNING id INTO v_rule_id;
  END IF;

  -- IDEMPOTENTE: limpa os alertas-máquina desta regra antes de reinserir
  DELETE FROM erp_truth_alerts
  WHERE rule_id = v_rule_id::text AND status IN ('novo','ignorado');

  FOR r_empresa IN
    SELECT id, nome_fantasia FROM companies
    WHERE id IN ('b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid, '25305b15-09e1-4abe-944f-9bff31743350'::uuid)
  LOOP
    v_empresas := v_empresas + 1;
    v_saldo_helper := fn_saldo_bancos_dinamico(ARRAY[r_empresa.id]);
    SELECT (fn_ge_contas_resumo(r_empresa.id) ->> 'saldo_total')::numeric INTO v_saldo_contas_resumo;
    IF ABS(COALESCE(v_saldo_helper,0) - COALESCE(v_saldo_contas_resumo,0)) > 0.01 THEN
      v_divergencias := v_divergencias + 1;
      INSERT INTO erp_truth_alerts (rule_id, company_id, area, severity, tipo_divergencia, mensagem, status)
      VALUES (v_rule_id, r_empresa.id, 'financeiro', 'warn', 'saldo_rpcs_divergem_v2',
        FORMAT('Empresa %s · helper_V2=R$%s vs contas_resumo=R$%s', r_empresa.nome_fantasia, v_saldo_helper::text, v_saldo_contas_resumo::text),
        'novo');
      v_alertas := v_alertas + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_alertas, v_empresas, v_divergencias;
END; $function$;

-- 3.5 — Links 404: NÃO tinha demote e insere sem rule_id → DELETE por tipo_divergencia.
CREATE OR REPLACE FUNCTION public.fn_truth_audit_links_404()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas int := 0; v_criticas int := 0; r_rota record; v_html text;
  v_links_potenciais text[]; v_link text; v_status int; v_request_id bigint; v_response record;
BEGIN
  -- IDEMPOTENTE: limpa os alertas-máquina deste tipo antes de reauditar
  DELETE FROM erp_truth_alerts
  WHERE tipo_divergencia = 'link_404_no_html' AND status IN ('novo','ignorado');

  FOR r_rota IN
    SELECT DISTINCT rota FROM system_screens
    WHERE estado_real IN ('pronto', 'parcial') AND prioridade_monitoramento IN ('critica', 'alta')
      AND rota LIKE '/dashboard/%' AND rota NOT LIKE '%[%'
      AND rota IN ('/dashboard/gestao-empresarial')
    LIMIT 5
  LOOP
    BEGIN
      SELECT INTO v_request_id net.http_get(url := 'https://erp-psgestao.vercel.app' || r_rota.rota || '?skip_onboarding=true', timeout_milliseconds := 15000);
      PERFORM pg_sleep(3);
      SELECT INTO v_response * FROM net._http_response WHERE id = v_request_id;
      v_html := v_response.content::text; v_status := v_response.status_code;
      SELECT ARRAY_AGG(DISTINCT match[1]) INTO v_links_potenciais
      FROM (SELECT regexp_matches(v_html, 'href="(/dashboard/[^"#?]+)"', 'g') AS match) t
      WHERE match[1] NOT LIKE '%/[%';
      IF v_links_potenciais IS NOT NULL THEN
        FOREACH v_link IN ARRAY v_links_potenciais LOOP
          BEGIN
            SELECT INTO v_request_id net.http_get(url := 'https://erp-psgestao.vercel.app' || v_link, timeout_milliseconds := 10000);
            PERFORM pg_sleep(2);
            SELECT INTO v_status status_code FROM net._http_response WHERE id = v_request_id;
            IF v_status = 404 THEN
              v_alertas := v_alertas + 1; v_criticas := v_criticas + 1;
              INSERT INTO erp_truth_alerts (area, severity, tipo_divergencia, mensagem, valor_esperado, valor_encontrado, recomendacao, status, detected_at)
              VALUES ('gestao_empresarial', 'critical', 'link_404_no_html',
                FORMAT('Rota %s tem link/botao no HTML apontando pra %s · retorna 404', r_rota.rota, v_link),
                '200', '404', 'Corrigir o link no codigo frontend OU criar rota destino', 'novo', NOW())
              ON CONFLICT DO NOTHING;
            END IF;
          EXCEPTION WHEN OTHERS THEN CONTINUE;
          END;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN CONTINUE;
    END;
  END LOOP;
  RETURN QUERY SELECT v_alertas, 1, v_criticas;
END $function$;
