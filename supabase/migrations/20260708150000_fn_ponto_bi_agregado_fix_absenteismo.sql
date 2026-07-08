-- PR-FIX Painel de Jornada: fault_full_time inclui FOLGA DE ESCALA/DSR (83
-- pessoas com 08:48 constante · valor de 1 dia-padrao) — nao e' falta. Redefine:
--   faltas    = fault_partial_time + justified_time + medical_certificate_time
--   folga_dsr = fault_full_time  (exposto separado, NAO descartado)
--   absenteismo_pct = faltas / NULLIF(trabalhadas + faltas, 0) * 100
-- HE inalterado (correto: over_time_1..4; dsr/holiday zerados no periodo).
--
-- Efeito validado (Frioeste): ABATE 18,6% -> 15,5% · empresa 19,2% -> 14,6%,
-- com folga/DSR (~1318h) separada. NOTA: justified_time tambem carrega valores
-- de dia-inteiro sistematicos (44:00/17:36/08:48) — provavel afastamento/licenca;
-- opcao (a) interina por decisao do CEO, refinamento futuro em aberto.

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
      -- FIX: faltas reais = parcial + justificada + atestado (SEM o dia integral,
      -- que carrega a folga de escala/DSR).
      SUM(
          fn_hhmm_decimal(l->'total_hours'->>'fault_partial_time')
        + fn_hhmm_decimal(l->'total_hours'->>'justified_time')
        + fn_hhmm_decimal(l->'total_hours'->>'medical_certificate_time')
      ) AS faltas,
      -- folga/DSR = o que era contado errado como falta (fault_full_time), agora explicito.
      SUM(fn_hhmm_decimal(l->'total_hours'->>'fault_full_time')) AS folga_dsr,
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
        'folga_dsr',         round(COALESCE(sum(folga_dsr), 0), 2),
        'noturno',           round(COALESCE(sum(noturno), 0), 2),
        'banco',             round(COALESCE(sum(banco), 0), 2),
        'headcount',         count(*),
        'absenteismo_pct',   round(COALESCE(sum(faltas) / NULLIF(sum(trabalhadas) + sum(faltas), 0) * 100, 0), 1)
      ) FROM base
    ),
    'por_departamento', (
      SELECT COALESCE(json_agg(d ORDER BY d.extras DESC), '[]'::json)
      FROM (
        SELECT departamento,
               round(sum(trabalhadas), 2) AS trabalhadas,
               round(sum(extras), 2)      AS extras,
               round(sum(faltas), 2)      AS faltas,
               round(sum(folga_dsr), 2)   AS folga_dsr,
               round(COALESCE(sum(faltas) / NULLIF(sum(trabalhadas) + sum(faltas), 0) * 100, 0), 1) AS absenteismo_pct,
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
               round(folga_dsr, 2)   AS folga_dsr,
               round(noturno, 2)     AS noturno
        FROM base
      ) x
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$;
