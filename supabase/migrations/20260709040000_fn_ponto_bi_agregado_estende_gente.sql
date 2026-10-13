-- Estende fn_ponto_bi_agregado (ADITIVO): HE por faixa (f1..f4/dsr/feriado), noturno/banco
-- por setor, banco por colaborador, admissões no período. Mantém 100% dos campos atuais.
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_agregado(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res json;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  WITH picked AS (
    SELECT DISTINCT ON (h.cpf)
      h.cpf, h.raw, c.nome,
      COALESCE(NULLIF(trim(c.departamento), ''), '(sem departamento)') AS departamento
    FROM ind_ponto_horas h
    LEFT JOIN ind_ponto_colaborador c ON c.cpf = h.cpf AND c.company_id = h.company_id
    WHERE h.company_id = p_company_id
      AND h.periodo_inicio <= p_data_fim AND h.periodo_fim >= p_data_ini
      AND (p_departamento IS NULL OR c.departamento = p_departamento)
    ORDER BY h.cpf, (h.periodo_fim - h.periodo_inicio) DESC, h.sincronizado_em DESC
  ),
  agg AS (
    SELECT p.cpf, p.nome, p.departamento,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'worked_time')) AS trabalhadas,
      SUM( fn_hhmm_decimal(l->'total_hours'->>'over_time_1') + fn_hhmm_decimal(l->'total_hours'->>'over_time_2')
         + fn_hhmm_decimal(l->'total_hours'->>'over_time_3') + fn_hhmm_decimal(l->'total_hours'->>'over_time_4') ) AS extras,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_1')) AS he1,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_2')) AS he2,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_3')) AS he3,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_4')) AS he4,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_dsr'))     AS he_dsr,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'over_time_holiday')) AS he_feriado,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'fault_partial_time')) AS faltas,
      SUM( fn_hhmm_decimal(l->'total_hours'->>'justified_time') + fn_hhmm_decimal(l->'total_hours'->>'medical_certificate_time') ) AS afast_horas,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'fault_full_time')) AS folga_dsr,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'night_time')) AS noturno,
      SUM(fn_hhmm_decimal(l->'total_hours'->>'bank_time'))  AS banco
    FROM picked p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.raw->'linhas') = 'array' THEN p.raw->'linhas' ELSE jsonb_build_array(p.raw) END
    ) AS l
    GROUP BY p.cpf, p.nome, p.departamento
  ),
  base AS (
    SELECT *, (trabalhadas = 0 AND afast_horas > 0) AS is_afastado,
      (trabalhadas = 0 AND faltas = 0 AND afast_horas = 0 AND folga_dsr = 0) AS is_vazio
    FROM agg
  ),
  ativos AS (SELECT * FROM base WHERE NOT is_vazio),
  adm AS (
    SELECT COALESCE(NULLIF(trim(departamento),''),'(sem departamento)') AS departamento, count(*) n
    FROM ind_ponto_colaborador
    WHERE company_id = p_company_id AND admissao IS NOT NULL AND admissao BETWEEN p_data_ini AND p_data_fim
      AND (p_departamento IS NULL OR departamento = p_departamento)
    GROUP BY 1
  )
  SELECT json_build_object(
    'periodo', json_build_object('inicio', p_data_ini, 'fim', p_data_fim),
    'departamento_filtro', p_departamento,
    'totais', (
      SELECT json_build_object(
        'horas_trabalhadas', round(COALESCE(sum(trabalhadas), 0), 2),
        'horas_extras',      round(COALESCE(sum(extras), 0), 2),
        'faltas',            round(COALESCE(sum(faltas), 0), 2),
        'faltas_pct',        round(COALESCE(sum(faltas) / NULLIF(sum(trabalhadas) + sum(faltas), 0) * 100, 0), 1),
        'afastados_qtd',     count(*) FILTER (WHERE is_afastado),
        'afastados_horas',   round(COALESCE(sum(afast_horas) FILTER (WHERE is_afastado), 0), 2),
        'folga_dsr',         round(COALESCE(sum(folga_dsr), 0), 2),
        'noturno',           round(COALESCE(sum(noturno), 0), 2),
        'banco',             round(COALESCE(sum(banco), 0), 2),
        'headcount',         count(*),
        'headcount_ativo',   count(*) FILTER (WHERE NOT is_afastado),
        'he_faixas', json_build_object(
          'f1', round(COALESCE(sum(he1),0),2), 'f2', round(COALESCE(sum(he2),0),2),
          'f3', round(COALESCE(sum(he3),0),2), 'f4', round(COALESCE(sum(he4),0),2),
          'dsr', round(COALESCE(sum(he_dsr),0),2), 'feriado', round(COALESCE(sum(he_feriado),0),2)
        ),
        'admissoes', (SELECT COALESCE(sum(n),0) FROM adm)
      ) FROM ativos
    ),
    'afastados_lista', (
      SELECT COALESCE(json_agg(a ORDER BY a.afast_horas DESC), '[]'::json)
      FROM (SELECT nome, departamento, round(afast_horas, 2) AS afast_horas FROM ativos WHERE is_afastado) a
    ),
    'por_departamento', (
      SELECT COALESCE(json_agg(d ORDER BY d.extras DESC), '[]'::json)
      FROM (
        SELECT departamento,
               round(sum(trabalhadas), 2) AS trabalhadas, round(sum(extras), 2) AS extras,
               round(sum(faltas), 2) AS faltas,
               round(COALESCE(sum(faltas) / NULLIF(sum(trabalhadas) + sum(faltas), 0) * 100, 0), 1) AS faltas_pct,
               count(*) FILTER (WHERE is_afastado) AS afastados_qtd,
               round(sum(folga_dsr), 2) AS folga_dsr, count(*) AS headcount,
               round(sum(noturno), 2) AS noturno, round(sum(banco), 2) AS banco,
               round(sum(he_dsr), 2) AS he_dsr, round(sum(he_feriado), 2) AS he_feriado,
               COALESCE((SELECT n FROM adm WHERE adm.departamento = ativos.departamento), 0) AS admissoes
        FROM ativos GROUP BY departamento
      ) d
    ),
    'por_colaborador', (
      SELECT COALESCE(json_agg(x ORDER BY x.extras DESC), '[]'::json)
      FROM (
        SELECT cpf, nome, departamento,
               round(trabalhadas, 2) AS trabalhadas, round(extras, 2) AS extras,
               round(faltas, 2) AS faltas, round(folga_dsr, 2) AS folga_dsr,
               round(noturno, 2) AS noturno, round(banco, 2) AS banco
        FROM ativos WHERE NOT is_afastado
      ) x
    )
  ) INTO v_res;
  RETURN v_res;
END;
$function$;
