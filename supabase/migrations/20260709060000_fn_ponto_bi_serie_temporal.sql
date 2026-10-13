-- Sala de Comando · Gente — série temporal AGREGADA (LGPD: zero nome).
-- A API IO Point /totalHours devolve total do PERÍODO por colaborador (não há
-- marcação por dia). Então a "curva ao longo do tempo" nasce de cada JANELA
-- sincronizada (periodo_inicio..periodo_fim): 1 ponto por janela, cresce a cada
-- sync — exatamente a decisão do CEO. Agregado por janela; nunca por pessoa.
-- Hierárquico: aceita p_departamento (o client passa só os setores do escopo).
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_serie(
  p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res json;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  WITH per AS (   -- 1 linha por (janela, cpf): soma as linhas de matrícula do raw
    SELECT h.periodo_inicio, h.periodo_fim, h.cpf,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'worked_time')) AS trabalhadas,
      SUM( fn_hhmm_decimal(l->'total_hours'->>'over_time_1') + fn_hhmm_decimal(l->'total_hours'->>'over_time_2')
         + fn_hhmm_decimal(l->'total_hours'->>'over_time_3') + fn_hhmm_decimal(l->'total_hours'->>'over_time_4') ) AS extras,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'fault_partial_time')) AS faltas,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'night_time')) AS noturno,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'bank_time'))  AS banco
    FROM ind_ponto_horas h
    LEFT JOIN ind_ponto_colaborador c ON c.cpf = h.cpf AND c.company_id = h.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(h.raw->'linhas') = 'array' THEN h.raw->'linhas' ELSE jsonb_build_array(h.raw) END
    ) AS l
    WHERE h.company_id = p_company_id
      AND h.periodo_inicio <= p_data_fim AND h.periodo_fim >= p_data_ini
      AND (p_departamento IS NULL OR c.departamento = p_departamento)
    GROUP BY h.periodo_inicio, h.periodo_fim, h.cpf
  ),
  janela AS (   -- agrega por janela (o "ponto" da curva)
    SELECT periodo_inicio, periodo_fim,
      round(sum(trabalhadas), 2) AS trabalhadas,
      round(sum(extras), 2) AS extras,
      round(sum(faltas), 2) AS faltas,
      round(COALESCE(sum(faltas) / NULLIF(sum(trabalhadas) + sum(faltas), 0) * 100, 0), 1) AS faltas_pct,
      round(COALESCE(sum(extras) / NULLIF(sum(trabalhadas), 0) * 100, 0), 1) AS extras_pct,
      round(sum(noturno), 2) AS noturno,
      round(sum(banco), 2) AS banco,
      count(DISTINCT cpf) AS headcount
    FROM per
    WHERE trabalhadas > 0 OR faltas > 0
    GROUP BY periodo_inicio, periodo_fim
  )
  SELECT COALESCE(json_agg(j ORDER BY j.periodo_inicio, j.periodo_fim), '[]'::json)
  INTO v_res FROM janela j;
  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_serie(uuid, date, date, text) TO authenticated, anon, service_role;
