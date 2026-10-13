-- BI do P&M · RPCs de cálculo (read-only) + documentação viva do catálogo.
-- Indicadores vêm de area_indicadores_mestres (genérico/editável); o cálculo real vive nas RPCs.
-- RD-51: indicador sem dado suficiente devolve valor NULL → a tela mostra "em cálculo" (não zero falso).
-- Pilar 2: tudo filtra company_id. Reusa erp_contratos (GE) pro MRR/recorrência.

-- 1) fonte_calculo (documentação) + direcao_boa (semáforo) dos 6 indicadores do moat
UPDATE area_indicadores_mestres SET
  direcao_boa = 'maior',
  fonte_calculo = 'Receita recorrente do mês (Σ erp_contratos.valor_mensal ativos) ÷ horas apontadas no mês (Σ agency_timesheet.horas).'
WHERE id='pm.ind.rht';
UPDATE area_indicadores_mestres SET
  direcao_boa = 'maior',
  fonte_calculo = '(Receita do mês − custo real) ÷ receita. Custo real = Σ agency_timesheet.custo_total do mês.'
WHERE id='pm.ind.margem_real';
UPDATE area_indicadores_mestres SET
  direcao_boa = 'maior',
  fonte_calculo = 'Jobs entregues no prazo (data_entrega ≤ data_prazo) ÷ jobs entregues (agency_jobs).'
WHERE id='pm.ind.on_time_delivery';
UPDATE area_indicadores_mestres SET
  direcao_boa = 'maior',
  fonte_calculo = 'Vida média dos contratos ativos: média de meses desde data_inicio (proxy de LTV brasileiro).'
WHERE id='pm.ind.vida_util_contrato';
UPDATE area_indicadores_mestres SET
  direcao_boa = 'maior',
  fonte_calculo = 'Média do Health Score por cliente (pagamento 40 + contato 15 + aprovação 15 + NPS 15 + retrabalho 15). Detalhe na tela dedicada; sem NPS/retrabalho aparece "em cálculo".'
WHERE id='pm.ind.health_score';
UPDATE area_indicadores_mestres SET
  direcao_boa = 'menor',
  fonte_calculo = 'Horas entre o alerta da IA e a ação do usuário. Sem eventos de IA registrados aparece "em cálculo".'
WHERE id='pm.ind.reacao_ia';

-- ---------------------------------------------------------------------------
-- 2) KPIs operacionais (faixa 1)
CREATE OR REPLACE FUNCTION public.fn_pm_bi_kpis(p_company_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v jsonb; v_mrr numeric; v_cli int; v_jobs int; v_horas numeric; v_com numeric; v_venc numeric;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;

  SELECT COALESCE(sum(valor_mensal),0) INTO v_mrr FROM erp_contratos
    WHERE company_id = ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL;
  SELECT count(*) INTO v_cli FROM agency_clientes
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo';
  SELECT count(*) INTO v_jobs FROM agency_jobs
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') NOT IN ('concluido','entregue','cancelado','arquivado');
  SELECT COALESCE(sum(horas),0) INTO v_horas FROM agency_timesheet
    WHERE company_id = ANY(p_company_ids) AND data >= date_trunc('month', current_date)::date;
  SELECT COALESCE(sum(valor_comissao),0) INTO v_com FROM agency_comissao
    WHERE company_id = ANY(p_company_ids) AND status IN ('prevista','a_pagar');
  SELECT COALESCE(sum(valor - COALESCE(valor_pago,0)),0) INTO v_venc FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') <> 'pago'
      AND data_vencimento < current_date AND deleted_at IS NULL;

  v := jsonb_build_object(
    'empty_state', false,
    'mrr', v_mrr, 'clientes_ativos', v_cli, 'jobs_andamento', v_jobs,
    'horas_mes', v_horas, 'comissao_pagar', v_com, 'receber_vencido', v_venc);
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_kpis(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Indicadores do moat (faixa 2) — catálogo (meta/unidade/direção) + valor calculado + semáforo
CREATE OR REPLACE FUNCTION public.fn_pm_bi_indicadores(p_company_ids uuid[])
RETURNS TABLE(sigla text, nome text, meta_numerica numeric, meta_unidade text,
  direcao_boa text, valor_calculado numeric, status_semaforo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH met AS (
    SELECT
      (SELECT COALESCE(sum(valor_mensal),0) FROM erp_contratos
        WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL) AS receita_mes,
      (SELECT COALESCE(sum(horas),0) FROM agency_timesheet
        WHERE company_id=ANY(p_company_ids) AND data >= date_trunc('month',current_date)::date) AS horas_mes,
      (SELECT COALESCE(sum(custo_total),0) FROM agency_timesheet
        WHERE company_id=ANY(p_company_ids) AND data >= date_trunc('month',current_date)::date) AS custo_mes,
      (SELECT count(*) FROM agency_jobs
        WHERE company_id=ANY(p_company_ids) AND data_entrega IS NOT NULL) AS jobs_entregues,
      (SELECT count(*) FROM agency_jobs
        WHERE company_id=ANY(p_company_ids) AND data_entrega IS NOT NULL
          AND data_prazo IS NOT NULL AND data_entrega <= data_prazo) AS jobs_prazo,
      (SELECT AVG( GREATEST(0, (current_date - data_inicio)) / 30.0 ) FROM erp_contratos
        WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL AND data_inicio IS NOT NULL) AS vida_meses
  ),
  comp AS (
    SELECT 'RHT'::text AS sigla, CASE WHEN m.horas_mes>0 THEN round(m.receita_mes/m.horas_mes,2) END AS valor FROM met m
    UNION ALL SELECT 'MRA', CASE WHEN m.receita_mes>0 THEN round((m.receita_mes-m.custo_mes)/m.receita_mes*100,1) END FROM met m
    UNION ALL SELECT 'OTDR', CASE WHEN m.jobs_entregues>0 THEN round(m.jobs_prazo::numeric/m.jobs_entregues*100,1) END FROM met m
    UNION ALL SELECT 'VUCB', CASE WHEN m.vida_meses IS NOT NULL THEN round(m.vida_meses,1) END FROM met m
    UNION ALL SELECT 'HSC', NULL::numeric FROM met m      -- em cálculo (NPS/retrabalho na tela dedicada)
    UNION ALL SELECT 'TRI', NULL::numeric FROM met m      -- em cálculo (sem eventos de IA)
  )
  SELECT c.sigla, c.nome, c.meta_numerica, c.meta_unidade, COALESCE(c.direcao_boa,'maior'),
    comp.valor,
    CASE
      WHEN comp.valor IS NULL THEN 'em_calculo'
      WHEN (COALESCE(c.direcao_boa,'maior')='maior' AND comp.valor >= c.meta_numerica)
        OR (c.direcao_boa='menor' AND comp.valor <= c.meta_numerica) THEN 'verde'
      WHEN (COALESCE(c.direcao_boa,'maior')='maior' AND comp.valor >= c.meta_numerica*0.8)
        OR (c.direcao_boa='menor' AND comp.valor <= c.meta_numerica*1.2) THEN 'amarelo'
      ELSE 'vermelho'
    END AS status_semaforo
  FROM area_indicadores_mestres c
  JOIN comp ON comp.sigla = c.sigla
  WHERE c.area='pm' AND c.bloco='agencia'
  ORDER BY c.sigla;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_indicadores(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Séries/gráficos (faixa 3): MRR/receita 12m + margem por cliente + top clientes por MRR
CREATE OR REPLACE FUNCTION public.fn_pm_bi_series(p_company_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_12m jsonb; v_margem jsonb; v_top jsonb; v_alertas jsonb;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;

  -- receita realizada por mês (últimos 12) via erp_receber (competência ou vencimento)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.mes), '[]'::jsonb) INTO v_12m FROM (
    SELECT to_char(m.mes,'YYYY-MM') AS mes,
      COALESCE((SELECT sum(r.valor) FROM erp_receber r
        WHERE r.company_id=ANY(p_company_ids) AND r.deleted_at IS NULL
          AND date_trunc('month', COALESCE(r.data_competencia, r.data_vencimento)) = m.mes), 0) AS valor
    FROM generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') AS m(mes)
  ) x;

  -- margem por cliente (fee mensal do cliente − custo apontado nos jobs dele)
  SELECT COALESCE(jsonb_agg(y ORDER BY y.receita DESC), '[]'::jsonb) INTO v_margem FROM (
    SELECT COALESCE(cl.nome_fantasia, cl.nome) AS cliente,
      COALESCE(cl.fee_mensal,0) AS receita,
      COALESCE(ts.custo,0) AS custo,
      COALESCE(cl.fee_mensal,0) - COALESCE(ts.custo,0) AS margem
    FROM agency_clientes cl
    LEFT JOIN (SELECT j.cliente_id, sum(t.custo_total) custo FROM agency_timesheet t
               JOIN agency_jobs j ON j.id=t.job_id
               WHERE t.company_id=ANY(p_company_ids) GROUP BY j.cliente_id) ts ON ts.cliente_id=cl.id
    WHERE cl.company_id=ANY(p_company_ids) AND COALESCE(cl.status,'ativo')='ativo'
    ORDER BY receita DESC LIMIT 8
  ) y;

  -- top 5 clientes por MRR (fee no cliente)
  SELECT COALESCE(jsonb_agg(z ORDER BY z.mrr DESC), '[]'::jsonb) INTO v_top FROM (
    SELECT COALESCE(nome_fantasia, nome) AS cliente, COALESCE(fee_mensal,0) AS mrr
    FROM agency_clientes WHERE company_id=ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo'
      AND COALESCE(fee_mensal,0) > 0
    ORDER BY fee_mensal DESC LIMIT 5
  ) z;

  -- alertas (faixa 4): jobs atrasados + contratos a renovar 60d + receber vencido
  SELECT jsonb_build_object(
    'jobs_atrasados', (SELECT count(*) FROM agency_jobs
      WHERE company_id=ANY(p_company_ids) AND data_prazo < current_date
        AND COALESCE(status,'') NOT IN ('concluido','entregue','cancelado','arquivado')),
    'contratos_renovar_60d', (SELECT count(*) FROM erp_contratos
      WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL
        AND data_fim IS NOT NULL AND data_fim BETWEEN current_date AND current_date + 60),
    'titulos_vencidos', (SELECT count(*) FROM erp_receber
      WHERE company_id=ANY(p_company_ids) AND COALESCE(status,'')<>'pago'
        AND data_vencimento < current_date AND deleted_at IS NULL)
  ) INTO v_alertas;

  RETURN jsonb_build_object('empty_state', false, 'receita_12m', v_12m,
    'margem_clientes', v_margem, 'top_clientes', v_top, 'alertas', v_alertas);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_series(uuid[]) TO authenticated;
