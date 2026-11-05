-- P&M · Painel (BI da Agência, /dashboard/pm) — PDCA aud8 82→≥95.
-- Autor: dev7claudeps (faixa de segundos :10–:19). Aditiva: só CREATE OR REPLACE de 2 RPCs
-- de BI da própria vertical P&M e INSERT idempotente de 9 chaves de ajuda (RD-95).
-- Não toca dado de cliente, financeiro, RLS, grants nem política de acesso.
--
-- BUG PROVADO (RD-38, BEGIN…ROLLBACK na empresa P&M DEMO b0700000-…-0002):
--   A lista de status "terminais" das RPCs usava apenas as formas masculinas/antigas
--   ('concluido','entregue','cancelado','arquivado'), mas agency_jobs.status grava
--   'concluida'/'publicado'. Resultado:
--     · "Jobs em andamento" (fn_pm_bi_kpis) contava jobs já concluídos → 66 em vez de 55.
--     · "Jobs atrasados" (fn_pm_bi_series) contava jobs concluídos com data_prazo passada
--       → 24 em vez de 15, podendo ULTRAPASSAR o total em andamento (a "inconsistência
--       de números" apontada pelo auditor: atrasados > andamento, impossível quando
--       atrasados é subconjunto de andamento).
--   Correção: lista de status terminais cobrindo as variantes reais (masc/fem/sing/plural).
--   Prova: andamento 66→55 e atrasados 24→15 (atrasados ≤ andamento, consistente).
--
-- CONSOLIDAÇÃO com #3729 (pedido do revisor 02/11 — evitar regressão silenciosa):
--   O KPI headline "MRR" somava erp_contratos.valor_mensal (contratos ERP genéricos),
--   mas o fee recorrente da agência vive em agency_contratos.fee_mensal e NÃO está
--   vinculado ao ERP. fn_pm_bi_series já usa fee_mensal nos gráficos "Top clientes por
--   MRR"/"Margem"; /contratos e /comercial também leem agency_contratos — só o KPI do
--   topo divergia. Esta PR assume a versão ÚNICA de fn_pm_bi_kpis com AS DUAS correções
--   (status terminais + origem do MRR) para que nenhuma delas seja revertida em produção.
--   Prova (dado, DEMO -002): mrr_antigo=2198,00 → mrr_novo=13800,00 (5 fees ativos).

-- 1) KPIs — "Jobs em andamento" exclui status terminais reais + MRR do fee recorrente
CREATE OR REPLACE FUNCTION public.fn_pm_bi_kpis(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; v_mrr numeric; v_cli int; v_jobs int; v_horas numeric; v_com numeric; v_venc numeric;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;
  -- MRR = fee recorrente da agência (agency_contratos), fonte única alinhada ao
  -- fn_pm_bi_series e às telas /contratos (Fees) e /comercial (consolidação #3729).
  SELECT COALESCE(sum(fee_mensal),0) INTO v_mrr FROM agency_contratos
    WHERE company_id = ANY(p_company_ids) AND status='ativo';
  SELECT count(*) INTO v_cli FROM agency_clientes
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo';
  SELECT count(*) INTO v_jobs FROM agency_jobs
    WHERE company_id = ANY(p_company_ids)
      AND COALESCE(status,'') NOT IN
        ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
      AND excluido_em IS NULL;
  SELECT COALESCE(sum(horas),0) INTO v_horas FROM agency_timesheet
    WHERE company_id = ANY(p_company_ids) AND data >= date_trunc('month', current_date)::date;
  SELECT COALESCE(sum(valor_comissao),0) INTO v_com FROM agency_comissao
    WHERE company_id = ANY(p_company_ids) AND status IN ('prevista','a_pagar');
  SELECT COALESCE(sum(valor - COALESCE(valor_pago,0)),0) INTO v_venc FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') <> 'pago'
      AND data_vencimento < current_date AND deleted_at IS NULL;
  v := jsonb_build_object('empty_state', false,
    'mrr', v_mrr, 'clientes_ativos', v_cli, 'jobs_andamento', v_jobs,
    'horas_mes', v_horas, 'comissao_pagar', v_com, 'receber_vencido', v_venc);
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_bi_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_kpis(uuid[]) TO authenticated, service_role;

-- 2) Séries — alerta "Jobs atrasados" exclui os mesmos status terminais reais
CREATE OR REPLACE FUNCTION public.fn_pm_bi_series(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_12m jsonb; v_margem jsonb; v_top jsonb; v_alertas jsonb;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.mes), '[]'::jsonb) INTO v_12m FROM (
    SELECT to_char(m.mes,'YYYY-MM') AS mes,
      COALESCE((SELECT sum(r.valor) FROM erp_receber r
        WHERE r.company_id=ANY(p_company_ids) AND r.deleted_at IS NULL
          AND date_trunc('month', COALESCE(r.data_competencia, r.data_vencimento)) = m.mes), 0) AS valor
    FROM generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') AS m(mes)
  ) x;
  SELECT COALESCE(jsonb_agg(y ORDER BY y.receita DESC), '[]'::jsonb) INTO v_margem FROM (
    SELECT COALESCE(cl.nome_fantasia, cl.nome) AS cliente,
      COALESCE(cl.fee_mensal,0) AS receita,
      COALESCE(ts.custo,0) AS custo,
      COALESCE(cl.fee_mensal,0) - COALESCE(ts.custo,0) AS margem
    FROM agency_clientes cl
    LEFT JOIN (SELECT j.cliente_id, sum(t.custo_total) custo FROM agency_timesheet t
               JOIN agency_jobs j ON j.id=t.job_id
               WHERE t.company_id=ANY(p_company_ids) AND j.excluido_em IS NULL GROUP BY j.cliente_id) ts ON ts.cliente_id=cl.id
    WHERE cl.company_id=ANY(p_company_ids) AND COALESCE(cl.status,'ativo')='ativo'
    ORDER BY receita DESC LIMIT 8
  ) y;
  SELECT COALESCE(jsonb_agg(z ORDER BY z.mrr DESC), '[]'::jsonb) INTO v_top FROM (
    SELECT COALESCE(nome_fantasia, nome) AS cliente, COALESCE(fee_mensal,0) AS mrr
    FROM agency_clientes WHERE company_id=ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo'
      AND COALESCE(fee_mensal,0) > 0
    ORDER BY fee_mensal DESC LIMIT 5
  ) z;
  SELECT jsonb_build_object(
    'jobs_atrasados', (SELECT count(*) FROM agency_jobs
      WHERE company_id=ANY(p_company_ids) AND data_prazo < current_date
        AND COALESCE(status,'') NOT IN
          ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
        AND excluido_em IS NULL),
    'contratos_renovar_60d', (SELECT count(*) FROM erp_contratos
      WHERE company_id=ANY(p_company_ids) AND status='ativo' AND excluido_em IS NULL
        AND data_fim IS NOT NULL AND data_fim BETWEEN current_date AND current_date + 60),
    'titulos_vencidos', (SELECT count(*) FROM erp_receber
      WHERE company_id=ANY(p_company_ids) AND COALESCE(status,'')<>'pago'
        AND data_vencimento < current_date AND deleted_at IS NULL)
  ) INTO v_alertas;
  RETURN jsonb_build_object('empty_state', false, 'receita_12m', v_12m,
    'margem_clientes', v_margem, 'top_clientes', v_top, 'alertas', v_alertas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_bi_series(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_series(uuid[]) TO authenticated, service_role;

-- 3) RD-95 — "?" dos 6 indicadores do moat + 3 gráficos (idempotente por chave única)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('pm.painel.ind_rht','/dashboard/pm','Painel · Indicadores do moat','RHT — Receita por Hora Trabalhada',
  'Indicador automático, não se preenche.',
  'Receita recorrente do mês (Σ contratos ativos) ÷ horas apontadas no mês. Mostra quanto cada hora de equipe rende.',
  'R$ 50.000 ÷ 400 h = R$ 125/hora.',
  'Aparece "em cálculo" quando não há horas apontadas no mês.','pm',20),
 ('pm.painel.ind_mra','/dashboard/pm','Painel · Indicadores do moat','MRA — Margem Real Acumulada',
  'Indicador automático, não se preenche.',
  'Lucratividade ao vivo: (receita do mês − custo real) ÷ receita. Custo real = Σ custo das horas apontadas.',
  'Receita R$ 50.000 e custo R$ 35.000 → margem 30%.',
  'Aparece "em cálculo" quando não há receita recorrente lançada no mês.','pm',21),
 ('pm.painel.ind_otdr','/dashboard/pm','Painel · Indicadores do moat','OTDR — Entrega no prazo',
  'Indicador automático, não se preenche.',
  'Percentual de jobs entregues dentro do prazo combinado (data de entrega ≤ data de prazo).',
  '18 de 20 jobs entregues no prazo → 90%.',
  'Aparece "em cálculo" quando ainda não há jobs com data de entrega.','pm',22),
 ('pm.painel.ind_vucb','/dashboard/pm','Painel · Indicadores do moat','VUCB — Vida útil do contrato',
  'Indicador automático, não se preenche.',
  'Vida média (em meses) dos contratos ativos desde o início — proxy do tempo de permanência do cliente.',
  'Contratos ativos há em média 24 meses → 24.',
  'Aparece "em cálculo" quando nenhum contrato ativo tem data de início.','pm',23),
 ('pm.painel.ind_hsc','/dashboard/pm','Painel · Indicadores do moat','HSC — Health Score do Cliente',
  'Indicador automático, não se preenche.',
  'Score 0–100 por cliente: pagamento (40) + contato (15) + aprovação (15) + NPS (15) + retrabalho (15). Antecipa churn.',
  'Cliente com pagamento em dia e boa aprovação → acima de 70 (verde).',
  'Aparece "em cálculo" enquanto não houver NPS e retrabalho registrados (fontes da onda 4).','pm',24),
 ('pm.painel.ind_tri','/dashboard/pm','Painel · Indicadores do moat','TRI — Tempo de reação à IA',
  'Indicador automático, não se preenche.',
  'Horas entre a IA detectar um problema e o usuário agir. Quanto menor, maior o engajamento com a plataforma.',
  'Alerta às 9h e ação às 11h → 2 horas.',
  'Aparece "em cálculo" enquanto não houver eventos de IA registrados.','pm',25),
 ('pm.painel.grafico_receita','/dashboard/pm','Painel · Gráficos','Receita (12 meses)',
  'Leitura automática, não se preenche.',
  'Receita por mês dos últimos 12 meses (títulos a receber por competência/vencimento). Mostra a tendência da agência.',
  'Barra de outubro = soma dos títulos com competência em outubro.',
  'Meses sem títulos lançados aparecem zerados.','pm',26),
 ('pm.painel.grafico_top_clientes','/dashboard/pm','Painel · Gráficos','Top clientes por MRR',
  'Leitura automática, não se preenche.',
  'Os 5 clientes com maior fee mensal (receita recorrente). Mostra a concentração de receita.',
  'Cliente com fee de R$ 8.000 encabeça a lista.',
  'Clientes sem fee mensal cadastrado não aparecem.','pm',27),
 ('pm.painel.grafico_margem','/dashboard/pm','Painel · Gráficos','Margem por cliente (fee − custo)',
  'Leitura automática, não se preenche.',
  'Fee mensal do cliente menos o custo das horas apontadas nos jobs dele. Verde = lucro, vermelho = prejuízo.',
  'Fee R$ 5.000 e custo R$ 3.000 → margem +R$ 2.000 (verde).',
  'Cliente sem horas apontadas mostra a margem igual ao fee.','pm',28)
ON CONFLICT (chave) DO NOTHING;
