-- PDCA P&M · /dashboard/pm/health-score — corrigir o CÁLCULO DA MARGEM (RD-38)
--
-- Bug (auditor_pdca_2, 02/11, DEMO Agência b0700000-0000-4000-a000-000000000002):
--   A CTE "ts" de custo somava agency_timesheet.custo_total agrupando por
--   t.cliente_id, mas a timesheet quase nunca tem cliente_id preenchido
--   (na DEMO: 5 de 1244 apontamentos). O vínculo real do apontamento com o
--   cliente é por t.job_id -> agency_jobs.cliente_id.
--   Resultado: a função capturava só ~6% do custo real (R$547,50 de R$9.102,75)
--   => c_margem = (receita - custo)/receita ~= 100 para quase todo cliente
--      (margem INFLADA/FALSA).
--
-- Correção (aditiva, apenas CREATE OR REPLACE da função; NÃO altera dado de
-- cliente): atribuir o custo de cada apontamento ao cliente DO JOB
-- (COALESCE(j.cliente_id, t.cliente_id) — fallback para t.cliente_id quando o
-- apontamento não tem job_id ou o job foi excluído). Janela e demais CTEs
-- inalteradas.
--
-- Prova no dado (RD-38), DEMO Agência, período 90d, antes -> depois:
--   custo total via timesheet: R$547,50 (velho) -> R$9.102,75 (novo)
--   margem por cliente (receita>0), margem_velha -> margem_nova:
--     Café Serra Azul        100   -> 26.7   (custo 0      -> 3877.80)
--     Moda Lume              100   -> 28.0   (custo 0      ->  978.75)
--     Academia Pulso         100   -> 40.2   (custo 0      -> 1740.00)
--     Construtora Horizonte  100   -> 58.7   (custo 0      -> 1957.50)
--     Clínica Sorriso Vale   93.5  -> 93.5   (já tinha cliente_id)
--     Escola/Pet/[BOT]/Imob. 100   -> 100    (sem custo de timesheet atribuível)
--   prazo / pagamento / atividade: inalterados.

CREATE OR REPLACE FUNCTION public.fn_agency_score_calcular(p_company_id uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_periodo_dias integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pesos jsonb;
  v_pp int; v_pm int; v_pg int; v_pa int;
  v_ini timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_periodo_dias, 90), 1));
  v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  v_pesos := public.fn_agency_score_pesos_get(p_company_id);
  v_pp := COALESCE((v_pesos->>'peso_prazo')::int, 30);
  v_pm := COALESCE((v_pesos->>'peso_margem')::int, 30);
  v_pg := COALESCE((v_pesos->>'peso_pagamento')::int, 20);
  v_pa := COALESCE((v_pesos->>'peso_atividade')::int, 20);

  WITH cli AS (
    SELECT c.id, COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.nome) AS nome, c.erp_cliente_id
    FROM agency_clientes c
    WHERE c.company_id = p_company_id AND c.status = 'ativo'
      AND (p_cliente_id IS NULL OR c.id = p_cliente_id)
  ),
  jw AS (  -- jobs na janela: prazo + receita
    SELECT j.cliente_id,
      count(*) FILTER (WHERE j.data_entrega IS NOT NULL AND j.data_prazo IS NOT NULL) AS entreg,
      count(*) FILTER (WHERE j.data_entrega IS NOT NULL AND j.data_prazo IS NOT NULL
                             AND j.data_entrega::date <= j.data_prazo) AS no_prazo,
      COALESCE(sum(j.valor_job), 0) AS receita
    FROM agency_jobs j
    WHERE j.company_id = p_company_id AND j.excluido_em IS NULL AND j.created_at >= v_ini
    GROUP BY j.cliente_id
  ),
  ja AS (  -- atividade: último job (qualquer data)
    SELECT j.cliente_id, max(j.created_at) AS ultimo
    FROM agency_jobs j
    WHERE j.company_id = p_company_id AND j.excluido_em IS NULL
    GROUP BY j.cliente_id
  ),
  ts AS (  -- custo pela timesheet na janela, atribuído ao cliente DO JOB
    SELECT COALESCE(j.cliente_id, t.cliente_id) AS cliente_id,
           COALESCE(sum(t.custo_total), 0) AS custo
    FROM agency_timesheet t
    LEFT JOIN agency_jobs j
      ON j.id = t.job_id AND j.company_id = t.company_id AND j.excluido_em IS NULL
    WHERE t.company_id = p_company_id AND t.data >= v_ini::date
      AND COALESCE(j.cliente_id, t.cliente_id) IS NOT NULL
    GROUP BY COALESCE(j.cliente_id, t.cliente_id)
  ),
  pg AS (  -- pagamento em dia via erp_receber (link erp_cliente_id)
    SELECT r.cliente_id,
      count(*) AS total,
      count(*) FILTER (WHERE r.data_pagamento IS NOT NULL AND r.data_pagamento <= r.data_vencimento) AS em_dia
    FROM erp_receber r
    WHERE r.company_id = p_company_id AND r.deleted_at IS NULL
      AND r.data_vencimento >= v_ini::date
      AND (r.data_pagamento IS NOT NULL OR r.data_vencimento < current_date)
    GROUP BY r.cliente_id
  ),
  calc AS (
    SELECT cli.id, cli.nome,
      CASE WHEN COALESCE(jw.entreg, 0) > 0
           THEN round(100.0 * jw.no_prazo / jw.entreg, 1) END AS c_prazo,
      CASE WHEN COALESCE(jw.receita, 0) > 0
           THEN GREATEST(0, LEAST(100, round(100.0 * (jw.receita - COALESCE(ts.custo, 0)) / jw.receita, 1))) END AS c_margem,
      CASE WHEN cli.erp_cliente_id IS NOT NULL AND COALESCE(pg.total, 0) > 0
           THEN round(100.0 * pg.em_dia / pg.total, 1) END AS c_pagamento,
      CASE WHEN ja.ultimo IS NULL THEN NULL
           WHEN (now() - ja.ultimo) <= interval '60 days' THEN 100.0
           WHEN (now() - ja.ultimo) <= interval '120 days' THEN 50.0
           ELSE 10.0 END AS c_atividade
    FROM cli
    LEFT JOIN jw ON jw.cliente_id = cli.id
    LEFT JOIN ja ON ja.cliente_id = cli.id
    LEFT JOIN ts ON ts.cliente_id = cli.id
    LEFT JOIN pg ON pg.cliente_id = cli.erp_cliente_id
  ),
  score AS (
    SELECT c.*,
      (CASE WHEN c_prazo     IS NOT NULL THEN v_pp ELSE 0 END
     + CASE WHEN c_margem    IS NOT NULL THEN v_pm ELSE 0 END
     + CASE WHEN c_pagamento IS NOT NULL THEN v_pg ELSE 0 END
     + CASE WHEN c_atividade IS NOT NULL THEN v_pa ELSE 0 END) AS peso_disp,
      (COALESCE(c_prazo, 0)     * CASE WHEN c_prazo     IS NOT NULL THEN v_pp ELSE 0 END
     + COALESCE(c_margem, 0)    * CASE WHEN c_margem    IS NOT NULL THEN v_pm ELSE 0 END
     + COALESCE(c_pagamento, 0) * CASE WHEN c_pagamento IS NOT NULL THEN v_pg ELSE 0 END
     + COALESCE(c_atividade, 0) * CASE WHEN c_atividade IS NOT NULL THEN v_pa ELSE 0 END) AS soma_pond
    FROM calc c
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'cliente_id', id, 'nome', nome,
             'prazo', c_prazo, 'margem', c_margem, 'pagamento', c_pagamento, 'atividade', c_atividade,
             'score', CASE WHEN peso_disp > 0 THEN round(soma_pond / peso_disp, 1) END,
             'dados_insuficientes', (peso_disp = 0)
           )
           ORDER BY CASE WHEN peso_disp > 0 THEN soma_pond / peso_disp ELSE -1 END DESC, nome
         )
    INTO v_rows
  FROM score;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo_dias', COALESCE(p_periodo_dias, 90),
    'pesos', jsonb_build_object('prazo', v_pp, 'margem', v_pm, 'pagamento', v_pg, 'atividade', v_pa),
    'clientes', COALESCE(v_rows, '[]'::jsonb)
  );
END $function$;

-- Harden a função SECURITY DEFINER (espelha a ACL viva: authenticated + service_role; sem anon)
REVOKE ALL ON FUNCTION public.fn_agency_score_calcular(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_score_calcular(uuid, uuid, integer) TO authenticated, service_role;
