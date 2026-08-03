-- RD-41 · Odonto — Painel de Indicadores da Agenda (PR2). Diferencial PS.
-- Agregados HONESTOS (RD-51/58) por cadeira e por profissional no período: tempo médio,
-- ocupação, atendimentos, receita [→GE via O0], ticket, no-show + resumo.
-- RD-26: reusa erp_odonto_agendamento + horario (#849) + planos O0 + erp_receber. Nada novo de dado.
-- FRONTEIRA GE: receita vem de erp_receber (títulos gerados pelos planos do profissional) — não recria financeiro.
-- Honesto: sem concluídos → tempo/ticket null; sem horário → ocupação null ("definir horário"); nunca inventa.

CREATE OR REPLACE FUNCTION public.fn_odonto_stats_agenda(
  p_company_id uuid, p_data_ini date, p_data_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_por_cadeira jsonb;
  v_por_prof    jsonb;
  v_resumo      jsonb;
BEGIN
  -- guard: só quem vê a empresa (indicador é leitura)
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;

  -- ── por CADEIRA ──────────────────────────────────────────────────────────
  WITH cad AS (
    SELECT c.id, c.nome, c.cor, c.horario FROM erp_odonto_cadeira c
     WHERE c.company_id = p_company_id AND COALESCE(c.ativo,true)
  ),
  ag AS (
    SELECT a.cadeira_id, a.status, a.hora_inicio, a.hora_fim
      FROM erp_odonto_agendamento a
     WHERE a.company_id = p_company_id AND a.data BETWEEN p_data_ini AND p_data_fim
  ),
  -- horas disponíveis por cadeira (só se houver horário): dias úteis do horário × horas/dia
  disp AS (
    SELECT c.id AS cadeira_id,
      CASE WHEN c.horario ? 'dias' AND c.horario ? 'inicio' AND c.horario ? 'fim' THEN
        (SELECT count(*) FROM generate_series(p_data_ini, p_data_fim, interval '1 day') d
          WHERE EXTRACT(isodow FROM d)::int IN (
            SELECT jsonb_array_elements_text(c.horario->'dias')::int))
        * GREATEST(EXTRACT(EPOCH FROM ((c.horario->>'fim')::time - (c.horario->>'inicio')::time))/3600.0, 0)
      ELSE NULL END AS horas_disp
    FROM cad c
  )
  SELECT jsonb_agg(jsonb_build_object(
    'cadeira_id', c.id, 'nome', c.nome, 'cor', c.cor,
    'total_ags', COALESCE(s.total,0),
    'concluidos', COALESCE(s.concluidos,0),
    -- tempo médio (min) só com concluídos; senão null (não inventa)
    'tempo_medio_min', s.tempo_medio_min,
    'horas_agendadas', ROUND(COALESCE(s.horas_ag,0)::numeric, 2),
    'horas_disponiveis', CASE WHEN d.horas_disp IS NULL THEN NULL ELSE ROUND(d.horas_disp::numeric,2) END,
    'ocupacao_pct', CASE WHEN d.horas_disp IS NULL OR d.horas_disp = 0 THEN NULL
                         ELSE ROUND((COALESCE(s.horas_ag,0)/d.horas_disp*100)::numeric, 1) END,
    'sem_horario', (d.horas_disp IS NULL),
    'no_show', COALESCE(s.no_show,0),
    'no_show_pct', CASE WHEN COALESCE(s.total,0)=0 THEN NULL ELSE ROUND((COALESCE(s.no_show,0)::numeric/s.total*100),1) END
  ) ORDER BY c.nome)
  INTO v_por_cadeira
  FROM cad c
  LEFT JOIN disp d ON d.cadeira_id = c.id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE status='concluido') AS concluidos,
      count(*) FILTER (WHERE status IN ('faltou','cancelado')) AS no_show,
      AVG(EXTRACT(EPOCH FROM (hora_fim - hora_inicio))/60.0) FILTER (WHERE status='concluido' AND hora_fim > hora_inicio) AS tempo_medio_min,
      SUM(EXTRACT(EPOCH FROM (hora_fim - hora_inicio))/3600.0) FILTER (WHERE status NOT IN ('faltou','cancelado') AND hora_fim > hora_inicio) AS horas_ag
    FROM ag WHERE ag.cadeira_id = c.id
  ) s ON true;

  -- ── por PROFISSIONAL ─────────────────────────────────────────────────────
  WITH prof AS (
    SELECT p.id, p.nome, p.cor FROM erp_odonto_profissional p
     WHERE p.company_id = p_company_id AND COALESCE(p.ativo,true)
  ),
  ag AS (
    SELECT a.profissional_id, a.status, a.hora_inicio, a.hora_fim
      FROM erp_odonto_agendamento a
     WHERE a.company_id = p_company_id AND a.data BETWEEN p_data_ini AND p_data_fim
  ),
  -- receita [→GE]: títulos de erp_receber gerados pelos planos do profissional aprovados no período
  rec AS (
    SELECT pt.profissional_id, SUM(r.valor) AS receita
      FROM erp_odonto_plano_tratamento pt
      JOIN erp_receber r ON r.ref_externa_id = pt.id::text AND r.company_id = p_company_id
     WHERE pt.company_id = p_company_id
       AND pt.aprovado_em IS NOT NULL
       AND pt.aprovado_em::date BETWEEN p_data_ini AND p_data_fim
     GROUP BY pt.profissional_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'profissional_id', p.id, 'nome', p.nome, 'cor', p.cor,
    'total_ags', COALESCE(s.total,0),
    'concluidos', COALESCE(s.concluidos,0),
    'tempo_medio_min', s.tempo_medio_min,
    'receita', COALESCE(rc.receita, 0),
    'tem_receita', (rc.receita IS NOT NULL),
    'ticket_medio', CASE WHEN COALESCE(s.concluidos,0)=0 OR rc.receita IS NULL THEN NULL
                         ELSE ROUND((rc.receita/s.concluidos)::numeric, 2) END,
    'no_show', COALESCE(s.no_show,0),
    'no_show_pct', CASE WHEN COALESCE(s.total,0)=0 THEN NULL ELSE ROUND((COALESCE(s.no_show,0)::numeric/s.total*100),1) END
  ) ORDER BY p.nome)
  INTO v_por_prof
  FROM prof p
  LEFT JOIN rec rc ON rc.profissional_id = p.id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE status='concluido') AS concluidos,
      count(*) FILTER (WHERE status IN ('faltou','cancelado')) AS no_show,
      AVG(EXTRACT(EPOCH FROM (hora_fim - hora_inicio))/60.0) FILTER (WHERE status='concluido' AND hora_fim > hora_inicio) AS tempo_medio_min
    FROM ag WHERE ag.profissional_id = p.id
  ) s ON true;

  -- ── RESUMO (topo) ────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'total_ags', COALESCE((SELECT count(*) FROM erp_odonto_agendamento WHERE company_id=p_company_id AND data BETWEEN p_data_ini AND p_data_fim),0),
    'total_concluidos', COALESCE((SELECT count(*) FROM erp_odonto_agendamento WHERE company_id=p_company_id AND data BETWEEN p_data_ini AND p_data_fim AND status='concluido'),0),
    -- ocupação média: só das cadeiras COM horário (as sem horário não entram — não distorce)
    'ocupacao_media_pct', (SELECT ROUND(AVG((e->>'ocupacao_pct')::numeric),1)
                             FROM jsonb_array_elements(COALESCE(v_por_cadeira,'[]'::jsonb)) e
                            WHERE e->>'ocupacao_pct' IS NOT NULL),
    'receita_periodo', COALESCE((
        SELECT SUM(r.valor) FROM erp_odonto_plano_tratamento pt
          JOIN erp_receber r ON r.ref_externa_id = pt.id::text AND r.company_id=p_company_id
         WHERE pt.company_id=p_company_id AND pt.aprovado_em::date BETWEEN p_data_ini AND p_data_fim), 0),
    'no_show_medio_pct', (SELECT ROUND(AVG((e->>'no_show_pct')::numeric),1)
                            FROM jsonb_array_elements(COALESCE(v_por_prof,'[]'::jsonb)) e
                           WHERE e->>'no_show_pct' IS NOT NULL)
  ) INTO v_resumo;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'resumo', v_resumo,
    'por_cadeira', COALESCE(v_por_cadeira, '[]'::jsonb),
    'por_profissional', COALESCE(v_por_prof, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_odonto_stats_agenda(uuid,date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_stats_agenda(uuid,date,date) TO authenticated;
