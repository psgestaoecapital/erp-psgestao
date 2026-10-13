-- ============================================================
-- BI de PONTO · FONTE CANÔNICA ÚNICA (cura da contradição entre telas).
--
-- PROBLEMA (raio-x 13/07): /industrial/ponto lia ind_ponto_dia (worked_time por
-- DIA, filtrável) e /inteligencia lia ind_ponto_horas (TOTAL de um período
-- fechado, que NÃO recorta por data). Mesmo campo do IO Point (worked_time),
-- granularidades diferentes → números diferentes pro mesmo intervalo. O gestor
-- não sabia em qual acreditar (a doença do André, agora no ponto).
--
-- CURA: uma fonte só = ind_ponto_dia. Esta função é o MOTOR CANÔNICO que as duas
-- telas passam a consumir. 100% agregado (LGPD: zero nome/cpf no retorno).
--
-- EXTRAS: ind_ponto_dia só tem worked_time + shift por dia (não tem a HE-CLT por
-- faixa do provedor). Então HE = max(worked − escala_do_turno, 0) por dia — é o
-- excedente sobre a jornada programada, filtrável por data. É ESTIMATIVA
-- operacional; a HE-CLT por faixa/DSR (fechamento) continua no bloco do provedor.
-- Turno "00:00-00:00" = folga (escala 0) → trabalhar na folga conta como extra.
-- ============================================================

-- escala programada do turno (segundos) a partir do shift "HH:MM-HH:MM HH:MM-HH:MM"
CREATE OR REPLACE FUNCTION public.fn_ponto_escala_segundos(p_shift text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_range text; v_ini text; v_fim text; v_si numeric; v_sf numeric;
BEGIN
  IF p_shift IS NULL OR btrim(p_shift) = '' THEN RETURN 0; END IF;
  FOREACH v_range IN ARRAY regexp_split_to_array(btrim(p_shift), '\s+') LOOP
    IF v_range !~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' THEN CONTINUE; END IF;
    v_ini := split_part(v_range, '-', 1);
    v_fim := split_part(v_range, '-', 2);
    v_si := split_part(v_ini, ':', 1)::numeric * 3600 + split_part(v_ini, ':', 2)::numeric * 60;
    v_sf := split_part(v_fim, ':', 1)::numeric * 3600 + split_part(v_fim, ':', 2)::numeric * 60;
    IF v_sf < v_si THEN v_sf := v_sf + 86400; END IF;   -- vira meia-noite
    v_total := v_total + (v_sf - v_si);
  END LOOP;
  RETURN v_total;
END; $function$;

-- MOTOR CANÔNICO: agregado por período (data_ini..data_fim), 100% de ind_ponto_dia.
-- Retorno agregado (sem nome/cpf). p_limite_dia_h = piso legal de infração de jornada.
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia_agregado(
  p_company_id uuid, p_data_ini date, p_data_fim date,
  p_departamento text DEFAULT NULL, p_limite_dia_h numeric DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_limite_seg numeric := GREATEST(p_limite_dia_h, 1) * 3600;
  v_tot jsonb; v_depto jsonb; v_por_dia jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  WITH base AS (
    SELECT d.cpf,
      COALESCE(NULLIF(btrim(d.department), ''), '(sem depto)') AS depto,
      d.data,
      COALESCE(d.worked_seconds, 0) AS ws,
      GREATEST(COALESCE(d.worked_seconds, 0) - fn_ponto_escala_segundos(d.shift), 0) AS extra_seg,
      COALESCE(d.total_pontos, 0) AS pontos,
      (COALESCE(d.worked_seconds, 0) > v_limite_seg) AS infracao
    FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data BETWEEN p_data_ini AND p_data_fim
      AND (p_departamento IS NULL OR d.department = p_departamento)
  ),
  g_depto AS (
    SELECT depto AS departamento,
      round(sum(ws) / 3600.0, 2) AS horas_trabalhadas,
      round(sum(extra_seg) / 3600.0, 2) AS horas_extras,
      count(*) FILTER (WHERE infracao) AS infracoes,
      count(DISTINCT cpf) AS headcount,
      sum(extra_seg) AS _ord
    FROM base GROUP BY depto
  ),
  g_dia AS (
    SELECT data,
      round(sum(ws) / 3600.0, 2) AS horas_trabalhadas,
      round(sum(extra_seg) / 3600.0, 2) AS horas_extras,
      count(*) FILTER (WHERE infracao) AS infracoes,
      count(DISTINCT cpf) AS presentes,
      sum(pontos) AS batidas
    FROM base GROUP BY data
  )
  SELECT
    (SELECT jsonb_build_object(
      'horas_trabalhadas', round(COALESCE(sum(ws), 0) / 3600.0, 2),
      'horas_extras',      round(COALESCE(sum(extra_seg), 0) / 3600.0, 2),
      'infracoes',         count(*) FILTER (WHERE infracao),
      'dias_com_registro', count(*),
      'headcount',         count(DISTINCT cpf)
    ) FROM base),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'departamento', departamento, 'horas_trabalhadas', horas_trabalhadas,
        'horas_extras', horas_extras, 'infracoes', infracoes, 'headcount', headcount
      ) ORDER BY _ord DESC), '[]'::jsonb) FROM g_depto),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'data', data, 'horas_trabalhadas', horas_trabalhadas, 'horas_extras', horas_extras,
        'infracoes', infracoes, 'presentes', presentes, 'batidas', batidas
      ) ORDER BY data), '[]'::jsonb) FROM g_dia)
  INTO v_tot, v_depto, v_por_dia;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('inicio', p_data_ini, 'fim', p_data_fim),
    'departamento_filtro', p_departamento,
    'tem_dados', (v_tot->>'dias_com_registro')::int > 0,
    'totais', COALESCE(v_tot, '{}'::jsonb),
    'por_departamento', v_depto,
    'por_dia', v_por_dia
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_ponto_escala_segundos(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_dia_agregado(uuid, date, date, text, numeric) TO authenticated;

-- Alinha o painel /industrial (mês) à MESMA definição de extra (worked − escala),
-- pra as duas telas casarem no detalhe também. Antes: extra = worked > 8h (naive).
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_colaborador_dias(
  p_company_id uuid, p_cpf text, p_ano int, p_mes int,
  p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_dias jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'data', d.data,
    'horas', round(COALESCE(d.worked_seconds,0)/3600.0, 2),
    'extras', round(GREATEST(COALESCE(d.worked_seconds,0) - fn_ponto_escala_segundos(d.shift), 0)/3600.0, 2),
    'batidas', COALESCE(d.total_pontos,0),
    'tem_ajuste', d.tem_ajuste,
    'infracao', (COALESCE(d.worked_seconds,0) > v_limite_seg),
    'shift', d.shift
  ) ORDER BY d.data), '[]'::jsonb)
  INTO v_dias
  FROM ind_ponto_dia d
  WHERE d.company_id = p_company_id AND d.cpf = p_cpf AND d.data BETWEEN v_ini AND v_fim;
  RETURN jsonb_build_object('ok', true, 'cpf', p_cpf, 'ano', p_ano, 'mes', p_mes, 'dias', v_dias);
END; $function$;

-- Alinha o resumo mensal por colaborador (L1 do painel /industrial) à mesma
-- definição de extra (worked − escala). Mantém todo o resto do contrato.
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia(
  p_company_id uuid, p_ano int, p_mes int,
  p_departamento text DEFAULT NULL, p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_dias_uteis int;
  v_por_colab jsonb;
  v_por_dia jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT count(*) INTO v_dias_uteis
  FROM generate_series(v_ini, v_fim, interval '1 day') g
  WHERE extract(isodow FROM g) < 6;

  WITH base AS (
    SELECT d.cpf, d.registration_number, COALESCE(NULLIF(btrim(d.department),''),'(sem depto)') AS depto,
           d.data, COALESCE(d.worked_seconds,0) AS ws,
           fn_ponto_escala_segundos(d.shift) AS escala_seg,
           GREATEST(COALESCE(d.worked_seconds,0) - fn_ponto_escala_segundos(d.shift), 0) AS extra_seg,
           d.total_pontos, d.tem_ajuste
    FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data BETWEEN v_ini AND v_fim
      AND (p_departamento IS NULL OR d.department = p_departamento)
  ),
  agg AS (
    SELECT b.cpf, max(b.registration_number) AS matricula, max(b.depto) AS depto,
      count(*) FILTER (WHERE b.ws > 0) AS dias_trabalhados,
      round(sum(b.ws)/3600.0, 2) AS horas_trabalhadas,
      round(sum(b.extra_seg)/3600.0, 2) AS horas_extras,
      round(sum(b.ws - b.escala_seg) FILTER (WHERE b.ws > 0)/3600.0, 2) AS banco_horas,
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
