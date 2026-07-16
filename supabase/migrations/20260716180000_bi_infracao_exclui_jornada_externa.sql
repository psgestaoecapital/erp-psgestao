-- BI GENTE · B3 — infração de jornada NÃO conta quem tem jornada_externa (RD-51/RD-38)
-- ============================================================================
-- Bug (auditoria ao vivo · Frioeste 975365cc · 16/07): o KPI "Infrações de jornada",
-- o semáforo por setor, o heatmap e o card de "risco de fadiga (SST)" contavam como
-- infração os dias com worked > limite legal (10h) — MAS ~44% desses dias eram de
-- colaboradores com jornada_externa (motoristas/externos, o caso Gabriel), que
-- legitimamente trabalham fora e cujas horas NÃO configuram infração de controle.
-- Prova (jul 01→16): 82 infrações → 46 reais (36 falsas de jornada_externa removidas).
-- Horas trabalhadas e headcount INALTERADOS — só a flag `infracao` muda.
--
-- Regra: infracao = worked_seconds > limite E a pessoa NÃO tem jornada_externa
-- (match em ind_pessoa por company + matrícula/CPF). Ausência em ind_pessoa = conta
-- normal (não some infração por falta de cadastro — só some quando PROVADO externo).
-- Única linha alterada da fn_ponto_bi_dia_agregado; todo o resto é idêntico.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia_agregado(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text, p_limite_dia_h numeric DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      -- B3: excede o limite legal E NÃO é jornada_externa (externo não comete infração de jornada)
      ( COALESCE(d.worked_seconds, 0) > v_limite_seg
        AND NOT EXISTS (
          SELECT 1 FROM ind_pessoa pp
          WHERE pp.company_id = d.company_id AND pp.jornada_externa
            AND (pp.matricula::text = d.registration_number OR pp.cpf = d.cpf)
        ) ) AS infracao
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
    'tem_dados', COALESCE((v_tot->>'dias_com_registro')::int, 0) > 0,
    'totais', COALESCE(v_tot, '{}'::jsonb),
    'por_departamento', v_depto,
    'por_dia', v_por_dia
  );
END; $function$;
