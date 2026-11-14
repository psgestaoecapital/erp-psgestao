-- Health Score do cliente (P&M · tarefa eng_chefe 37420d3e) — PR (2): CÁLCULO.
-- Fórmula aprovada pelo CEO, pesos EDITÁVEIS por empresa (agency_score_pesos, PR 1):
--   prazo 30 + margem 30 + pagamento 20 + atividade 20 = 100 (padrão).
-- Esta PR entrega a RPC de cálculo, com os 4 componentes SEPARADOS e "dados insuficientes"
-- quando faltar base (RD-38): o score re-normaliza os pesos sobre os componentes que TÊM dado.
-- Componentes (por cliente, na janela de p_periodo_dias):
--   • prazo      = % de jobs entregues no prazo (data_entrega <= data_prazo) entre os entregues com prazo;
--   • margem     = (receita - custo)/receita, receita = sum(valor_job), custo = sum(timesheet.custo_total), 0..100;
--   • pagamento  = % de títulos de erp_receber (via agency_clientes.erp_cliente_id) pagos em dia;
--   • atividade  = recência do último job (<=60d=100, <=120d=50, senão 10).
-- ADITIVA: função NOVA, somente leitura (STABLE); nada existente é alterado. RLS/guarda por empresa.

CREATE OR REPLACE FUNCTION public.fn_agency_score_calcular(
  p_company_id uuid, p_cliente_id uuid DEFAULT NULL, p_periodo_dias int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  ts AS (  -- custo pela timesheet na janela
    SELECT t.cliente_id, COALESCE(sum(t.custo_total), 0) AS custo
    FROM agency_timesheet t
    WHERE t.company_id = p_company_id AND t.cliente_id IS NOT NULL AND t.data >= v_ini::date
    GROUP BY t.cliente_id
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

REVOKE EXECUTE ON FUNCTION public.fn_agency_score_calcular(uuid, uuid, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_agency_score_calcular(uuid, uuid, int) TO authenticated, service_role;
