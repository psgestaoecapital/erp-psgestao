-- P0 · fn_ponto_atrasos causava statement timeout em períodos longos (3,5 meses > 60s).
-- Causa: subqueries CORRELACIONADAS — para cada dia-colaborador, varria o CTE `ins`
-- inteiro (O(n²)). Reescrito com JOIN sched×ins + GROUP BY (uma passada). Índices já
-- existem (ind_ponto_dia_comp_data, ind_ponto_marcacao_comp_data). Contrato idêntico.
CREATE OR REPLACE FUNCTION public.fn_ponto_atrasos(
  p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL,
  p_tol_marcacao_min numeric DEFAULT 5, p_tol_dia_min numeric DEFAULT 10,
  p_janela_antes_h numeric DEFAULT 1, p_janela_depois_h numeric DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tol_marc numeric := GREATEST(p_tol_marcacao_min,0)*60;
  v_tol_dia numeric := GREATEST(p_tol_dia_min,0)*60;
  v_ja numeric := GREATEST(p_janela_antes_h,0)*3600;
  v_jd numeric := GREATEST(p_janela_depois_h,0.5)*3600;
  v_tot jsonb; v_depto jsonb; v_dia jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  WITH sched AS (
    SELECT d.cpf, d.data, COALESCE(NULLIF(btrim(d.department),''),'(sem depto)') setor,
      (split_part(split_part((regexp_split_to_array(btrim(d.shift),'\s+'))[1],'-',1),':',1)::int*3600
        + split_part(split_part((regexp_split_to_array(btrim(d.shift),'\s+'))[1],'-',1),':',2)::int*60) AS s_manha,
      CASE WHEN (regexp_split_to_array(btrim(d.shift),'\s+'))[2] IS NULL THEN NULL
        ELSE split_part(split_part((regexp_split_to_array(btrim(d.shift),'\s+'))[2],'-',1),':',1)::int*3600
           + split_part(split_part((regexp_split_to_array(btrim(d.shift),'\s+'))[2],'-',1),':',2)::int*60 END AS s_tarde
    FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND d.data BETWEEN p_data_ini AND p_data_fim
      AND d.shift IS NOT NULL AND d.shift <> '00:00-00:00'
      AND d.shift ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}'
      AND (p_departamento IS NULL OR d.department = p_departamento)
  ),
  ins AS (  -- batidas de ENTRADA = posições ímpares
    SELECT cpf, data, seg FROM (
      SELECT m.cpf, m.data, extract(epoch FROM m.hora)::int seg,
        row_number() OVER (PARTITION BY m.cpf, m.data ORDER BY m.datetime) rn
      FROM ind_ponto_marcacao m
      WHERE m.company_id=p_company_id AND m.data BETWEEN p_data_ini AND p_data_fim AND m.hora IS NOT NULL
    ) x WHERE rn % 2 = 1
  ),
  -- JOIN (não correlacionado): 1ª entrada dentro da janela de cada metade, por dia
  matched AS (
    SELECT s.cpf, s.data, s.setor, s.s_manha, s.s_tarde,
      min(i.seg) FILTER (WHERE i.seg BETWEEN s.s_manha - v_ja AND s.s_manha + v_jd) AS in_manha,
      min(i.seg) FILTER (WHERE s.s_tarde IS NOT NULL AND i.seg BETWEEN s.s_tarde - v_ja AND s.s_tarde + v_jd) AS in_tarde
    FROM sched s
    LEFT JOIN ins i ON i.cpf = s.cpf AND i.data = s.data
    GROUP BY s.cpf, s.data, s.setor, s.s_manha, s.s_tarde
  ),
  raw AS (
    SELECT cpf, data, setor,
      CASE WHEN in_manha IS NULL THEN 0 ELSE GREATEST(in_manha - s_manha, 0) END AS am,
      CASE WHEN in_tarde IS NULL THEN 0 ELSE GREATEST(in_tarde - s_tarde, 0) END AS at
    FROM matched
  ),
  clt AS (
    SELECT cpf, data, setor,
      CASE WHEN am <= v_tol_marc AND at <= v_tol_marc AND (am+at) <= v_tol_dia THEN 0 ELSE am END AS cam,
      CASE WHEN am <= v_tol_marc AND at <= v_tol_marc AND (am+at) <= v_tol_dia THEN 0 ELSE at END AS cat
    FROM raw
  )
  SELECT
    (SELECT jsonb_build_object(
       'ocorrencias_manha', count(*) FILTER (WHERE cam>0),
       'ocorrencias_pos_almoco', count(*) FILTER (WHERE cat>0),
       'minutos_manha', round(sum(cam)/60.0,0),
       'minutos_pos_almoco', round(sum(cat)/60.0,0),
       'pessoas_com_atraso', count(DISTINCT cpf) FILTER (WHERE cam>0 OR cat>0),
       'dias_avaliados', count(*)
     ) FROM clt),
    (SELECT COALESCE(jsonb_agg(to_jsonb(z) ORDER BY z.min_total DESC),'[]'::jsonb) FROM (
       SELECT setor,
         count(*) FILTER (WHERE cam>0) AS oc_manha,
         count(*) FILTER (WHERE cat>0) AS oc_pos,
         round((sum(cam)+sum(cat))/60.0,0) AS min_total,
         count(DISTINCT cpf) FILTER (WHERE cam>0 OR cat>0) AS pessoas
       FROM clt GROUP BY setor HAVING count(*) FILTER (WHERE cam>0 OR cat>0) > 0
     ) z),
    (SELECT COALESCE(jsonb_agg(to_jsonb(z) ORDER BY z.data),'[]'::jsonb) FROM (
       SELECT data,
         count(*) FILTER (WHERE cam>0) AS oc_manha,
         count(*) FILTER (WHERE cat>0) AS oc_pos,
         round((sum(cam)+sum(cat))/60.0,0) AS min_total
       FROM clt GROUP BY data
     ) z)
  INTO v_tot, v_depto, v_dia;

  RETURN jsonb_build_object('ok', true,
    'periodo', jsonb_build_object('inicio', p_data_ini, 'fim', p_data_fim),
    'tolerancia', jsonb_build_object('marcacao_min', p_tol_marcacao_min, 'dia_min', p_tol_dia_min),
    'totais', COALESCE(v_tot, '{}'::jsonb), 'por_departamento', v_depto, 'por_dia', v_dia);
END; $function$;
