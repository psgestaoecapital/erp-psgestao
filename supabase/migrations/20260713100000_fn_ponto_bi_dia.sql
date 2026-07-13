-- ============================================================
-- PONTO GRANULAR · BI por DIA (drill-down mês → dia → batidas).
--
-- Hoje o BI lê ind_ponto_horas (só o TOTAL do período). Estas RPCs leem a
-- granularidade real: ind_ponto_dia (dia a dia) + ind_ponto_marcacao (batidas).
-- Ficam prontas para o momento em que o cron/ backfill popular essas tabelas
-- (hoje vazias — retornam estruturas vazias, sem erro).
--
-- Métricas (jornada-padrão configurável, default 8h/dia): horas trabalhadas,
-- extras, banco de horas, faltas estimadas (dias úteis sem registro) e
-- infrações de jornada (dia com > limite legal de horas). Precisão fina de
-- atraso/CLT depende da jornada individual (vem numa fase seguinte / config).
-- LGPD: nome fica em ind_ponto_colaborador; as tabelas de ponto guardam cpf/matrícula.
-- ============================================================

-- BI mensal por dia + por colaborador -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia(
  p_company_id uuid, p_ano int, p_mes int,
  p_departamento text DEFAULT NULL, p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_jornada_seg numeric := GREATEST(p_jornada_h, 0.01) * 3600;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_dias_uteis int;
  v_por_colab jsonb;
  v_por_dia jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- dias úteis (seg–sex) do mês (feriados ignorados nesta fase)
  SELECT count(*) INTO v_dias_uteis
  FROM generate_series(v_ini, v_fim, interval '1 day') g
  WHERE extract(isodow FROM g) < 6;

  -- por colaborador
  WITH base AS (
    SELECT d.cpf, d.registration_number, COALESCE(NULLIF(btrim(d.department),''),'(sem depto)') AS depto,
           d.data, COALESCE(d.worked_seconds,0) AS ws, d.total_pontos, d.tem_ajuste
    FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data BETWEEN v_ini AND v_fim
      AND (p_departamento IS NULL OR d.department = p_departamento)
  ),
  agg AS (
    SELECT b.cpf, max(b.registration_number) AS matricula, max(b.depto) AS depto,
      count(*) FILTER (WHERE b.ws > 0) AS dias_trabalhados,
      round(sum(b.ws)/3600.0, 2) AS horas_trabalhadas,
      round(sum(GREATEST(b.ws - v_jornada_seg, 0))/3600.0, 2) AS horas_extras,
      round(sum(b.ws - v_jornada_seg) FILTER (WHERE b.ws > 0)/3600.0, 2) AS banco_horas,
      count(*) FILTER (WHERE b.ws > v_limite_seg) AS dias_infracao,
      count(*) FILTER (WHERE b.tem_ajuste) AS dias_ajustados
    FROM base b GROUP BY b.cpf
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cpf', a.cpf, 'matricula', a.matricula, 'nome', c.nome, 'departamento', a.depto,
    'dias_trabalhados', a.dias_trabalhados, 'horas_trabalhadas', a.horas_trabalhadas,
    'horas_extras', a.horas_extras, 'banco_horas', a.banco_horas,
    'faltas_estimadas', GREATEST(v_dias_uteis - a.dias_trabalhados, 0),
    'dias_infracao', a.dias_infracao, 'dias_ajustados', a.dias_ajustados
  ) ORDER BY a.horas_extras DESC NULLS LAST, c.nome), '[]'::jsonb)
  INTO v_por_colab
  FROM agg a LEFT JOIN ind_ponto_colaborador c ON c.cpf = a.cpf AND c.company_id = p_company_id;

  -- por dia (série do mês)
  WITH pd AS (
    SELECT d.data, count(DISTINCT d.cpf) AS presentes,
           round(sum(COALESCE(d.worked_seconds,0))/3600.0, 2) AS horas,
           sum(COALESCE(d.total_pontos,0)) AS batidas
    FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data BETWEEN v_ini AND v_fim
      AND (p_departamento IS NULL OR d.department = p_departamento)
    GROUP BY d.data
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('data', data, 'presentes', presentes,
    'horas', horas, 'batidas', batidas) ORDER BY data), '[]'::jsonb)
  INTO v_por_dia FROM pd;

  RETURN jsonb_build_object(
    'ok', true, 'ano', p_ano, 'mes', p_mes, 'jornada_h', p_jornada_h,
    'dias_uteis', v_dias_uteis,
    'tem_dados', (SELECT EXISTS (SELECT 1 FROM ind_ponto_dia WHERE company_id=p_company_id AND data BETWEEN v_ini AND v_fim)),
    'por_colaborador', v_por_colab, 'por_dia', v_por_dia);
END; $function$;

-- Batidas de um colaborador num dia (o fundo do drill-down) --------------------
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_marcacoes(p_company_id uuid, p_cpf text, p_data date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hora', hora, 'datetime', datetime, 'method', method, 'origin', origin,
    'is_adjusted', is_adjusted, 'adjustment_reason', adjustment_reason, 'has_audit_photo', has_audit_photo
  ) ORDER BY datetime), '[]'::jsonb)
  INTO v_res
  FROM ind_ponto_marcacao
  WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data;
  RETURN jsonb_build_object('ok', true, 'cpf', p_cpf, 'data', p_data, 'batidas', v_res);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_dia(uuid, int, int, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_marcacoes(uuid, text, date) TO authenticated;
