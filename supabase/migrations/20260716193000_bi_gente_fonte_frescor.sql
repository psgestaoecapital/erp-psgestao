-- SELO DE FRESCOR DE DADOS — cada RPC de BI de Gente devolve a data REAL do seu dado + último sync (RD-51).
-- ============================================================================
-- Origem: o CEO teve dúvida legítima ao vivo ("fechamento mostra 13, filtrei 16") — a resposta era
-- latência entre pipelines (fechamento=14/07, marcação diária=13/07). Ninguém deveria precisar
-- perguntar: a tela tem que DIZER sozinha até onde o dado vai e de onde vem.
--
-- Aditivo e seguro: só ACRESCENTA a chave 'fonte' em cada função; toda chave existente permanece
-- byte-idêntica (nenhum número muda). O front (<SeloFrescor>) lê 'fonte' e nunca inventa data.
--
-- Regras (RD-51):
--   • data_ate = última data REAL da fonte (nunca now(), nunca a data do filtro).
--   • fechamento: período do fechamento REALMENTE escolhido pela query (maior span sobrepondo a janela),
--     não mais min..max de todos os fechamentos — corrige também o rótulo (Part 3).
--   • tem_dados=false quando o período filtrado não tem dado naquela fonte (ex: junho sem fechamento).
-- ============================================================================

-- 1) PROVEDOR (fechamento) — 'fonte' = período do fechamento REALMENTE escolhido + sync.
--    picked passa a carregar periodo_inicio/fim/sincronizado_em (mesma seleção: maior span, sync mais novo).
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_agregado(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res json;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  WITH picked AS (
    SELECT DISTINCT ON (h.cpf)
      h.cpf, h.raw, c.nome,
      h.periodo_inicio, h.periodo_fim, h.sincronizado_em,
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
    -- SELO DE FRESCOR: período do fechamento REALMENTE usado + último sync (nunca now()/filtro)
    'fonte', (SELECT json_build_object(
        'tem_dados', count(*) > 0,
        'data_ate', max(periodo_fim),
        'periodo_inicio', min(periodo_inicio),
        'periodo_fim', max(periodo_fim),
        'sincronizado_em', max(sincronizado_em)
      ) FROM picked),
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

-- 2) CANÔNICO (marcação diária) — 'fonte' = última data com registro na janela + último sync.
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia_agregado(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text, p_limite_dia_h numeric DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limite_seg numeric := GREATEST(p_limite_dia_h, 1) * 3600;
  v_tot jsonb; v_depto jsonb; v_por_dia jsonb; v_fonte jsonb;
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
      ) ORDER BY data), '[]'::jsonb) FROM g_dia),
    -- SELO DE FRESCOR: última data REAL com registro na janela + último sync da marcação
    (SELECT jsonb_build_object(
        'tem_dados', count(*) > 0,
        'data_ate', max(d.data),
        'sincronizado_em', max(d.sincronizado_em)
      )
      FROM ind_ponto_dia d
      WHERE d.company_id = p_company_id AND d.data BETWEEN p_data_ini AND p_data_fim
        AND (p_departamento IS NULL OR d.department = p_departamento))
  INTO v_tot, v_depto, v_por_dia, v_fonte;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('inicio', p_data_ini, 'fim', p_data_fim),
    'departamento_filtro', p_departamento,
    'tem_dados', COALESCE((v_tot->>'dias_com_registro')::int, 0) > 0,
    'fonte', COALESCE(v_fonte, jsonb_build_object('tem_dados', false)),
    'totais', COALESCE(v_tot, '{}'::jsonb),
    'por_departamento', v_depto,
    'por_dia', v_por_dia
  );
END; $function$;
