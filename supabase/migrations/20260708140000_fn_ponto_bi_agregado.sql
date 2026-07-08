-- PR-1 Painel de Jornada (BI de Ponto · Fase 4). Agrega ind_ponto_horas por
-- periodo/departamento convertendo os campos HH:MM de raw->linhas->total_hours
-- em decimal. Helper fn_hhmm_decimal = equivalente SQL do hhmmParaDecimal (#560):
-- aceita >24h e negativo. Guard multi-tenant P2. Subselects (nao json_agg DISTINCT).
--
-- Aplicada via MCP em 2026-07-08. Validada empiricamente contra Frioeste:
-- trabalhadas=5867.5h bate com o total do log de sync (5867.56h).

CREATE OR REPLACE FUNCTION fn_hhmm_decimal(v text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR v !~ '^-?\d+:\d{2}$' THEN 0
    ELSE (CASE WHEN left(v,1) = '-' THEN -1 ELSE 1 END)
       * ( (split_part(ltrim(v,'-'), ':', 1))::numeric
         + (split_part(ltrim(v,'-'), ':', 2))::numeric / 60.0 )
  END
$$;

CREATE OR REPLACE FUNCTION fn_ponto_bi_agregado(
  p_company_id   uuid,
  p_data_ini     date,
  p_data_fim     date,
  p_departamento text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res json;
BEGIN
  -- P2 guard multi-tenant
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  WITH base AS (
    SELECT
      h.cpf,
      c.nome,
      COALESCE(NULLIF(trim(c.departamento), ''), '(sem departamento)') AS departamento,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'worked_time')) AS trabalhadas,
      SUM(
          fn_hhmm_decimal(l->'total_hours'->>'over_time_1')
        + fn_hhmm_decimal(l->'total_hours'->>'over_time_2')
        + fn_hhmm_decimal(l->'total_hours'->>'over_time_3')
        + fn_hhmm_decimal(l->'total_hours'->>'over_time_4')
      ) AS extras,
      SUM(
          fn_hhmm_decimal(l->'total_hours'->>'fault_full_time')
        + fn_hhmm_decimal(l->'total_hours'->>'fault_partial_time')
      ) AS faltas,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'night_time')) AS noturno,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'bank_time'))  AS banco
    FROM ind_ponto_horas h
    LEFT JOIN ind_ponto_colaborador c
      ON c.cpf = h.cpf AND c.company_id = h.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(h.raw->'linhas') = 'array'
           THEN h.raw->'linhas'
           ELSE jsonb_build_array(h.raw) END
    ) AS l
    WHERE h.company_id = p_company_id
      AND h.periodo_inicio <= p_data_fim
      AND h.periodo_fim   >= p_data_ini
      AND (p_departamento IS NULL OR c.departamento = p_departamento)
    GROUP BY h.cpf, c.nome, COALESCE(NULLIF(trim(c.departamento), ''), '(sem departamento)')
  )
  SELECT json_build_object(
    'periodo', json_build_object('inicio', p_data_ini, 'fim', p_data_fim),
    'departamento_filtro', p_departamento,
    'totais', (
      SELECT json_build_object(
        'horas_trabalhadas', round(COALESCE(sum(trabalhadas), 0), 2),
        'horas_extras',      round(COALESCE(sum(extras), 0), 2),
        'faltas',            round(COALESCE(sum(faltas), 0), 2),
        'noturno',           round(COALESCE(sum(noturno), 0), 2),
        'banco',             round(COALESCE(sum(banco), 0), 2),
        'headcount',         count(*),
        'absenteismo_pct',   round(CASE WHEN COALESCE(sum(trabalhadas),0)+COALESCE(sum(faltas),0) > 0
                                        THEN sum(faltas)/(sum(trabalhadas)+sum(faltas))*100 ELSE 0 END, 1)
      ) FROM base
    ),
    'por_departamento', (
      SELECT COALESCE(json_agg(d ORDER BY d.extras DESC), '[]'::json)
      FROM (
        SELECT departamento,
               round(sum(trabalhadas), 2) AS trabalhadas,
               round(sum(extras), 2)      AS extras,
               round(sum(faltas), 2)      AS faltas,
               round(CASE WHEN sum(trabalhadas)+sum(faltas) > 0
                          THEN sum(faltas)/(sum(trabalhadas)+sum(faltas))*100 ELSE 0 END, 1) AS absenteismo_pct,
               count(*) AS headcount
        FROM base GROUP BY departamento
      ) d
    ),
    'por_colaborador', (
      SELECT COALESCE(json_agg(x ORDER BY x.extras DESC), '[]'::json)
      FROM (
        SELECT cpf, nome, departamento,
               round(trabalhadas, 2) AS trabalhadas,
               round(extras, 2)      AS extras,
               round(faltas, 2)      AS faltas,
               round(noturno, 2)     AS noturno
        FROM base
      ) x
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_hhmm_decimal(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_ponto_bi_agregado(uuid, date, date, text) TO authenticated;
