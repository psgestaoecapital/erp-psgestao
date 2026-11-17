-- Chamado #8150 (/dashboard/industrial/ponto) — "Registrar motivo da infração"
-- O painel por dia marcava QUE houve infração de jornada, mas não o MOTIVO, e não
-- trazia a quantidade por motivo (geral e por setor) no topo.
--
-- Hoje a infração de jornada tem UMA regra: dia trabalhado acima do limite diário
-- (worked_seconds > GREATEST(limite_dia_h, jornada_h)). Esta migration EXPÕE esse
-- motivo (sem inventar regra nova): aditiva ao JSON de retorno, sem alterar o cálculo
-- existente (dias_infracao continua igual), sem tocar dado de cliente.
--   1) fn_ponto_bi_dia             → + limite_dia_h, infracoes_total, infracoes_por_motivo, infracoes_por_setor
--   2) fn_ponto_bi_colaborador_dias → + motivo_infracao por dia (NULL quando não há infração)
--   3) RD-95: chave de ajuda "?" do novo bloco "Infrações por motivo".
-- CREATE OR REPLACE preserva assinatura, guarda de empresa (fail-closed) e grants.
-- Code: code-desenvolvedor-3

-- 1) Resumo do mês + breakdown de infração por motivo e por setor ---------------------
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_dia(p_company_id uuid, p_ano integer, p_mes integer, p_departamento text DEFAULT NULL::text, p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_limite_h numeric := round(v_limite_seg/3600.0, 1);
  v_motivo text := 'Jornada acima do limite diário';
  v_dias_uteis int;
  v_por_colab jsonb;
  v_por_dia jsonb;
  v_infra_total int;
  v_infra_por_setor jsonb;
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

  -- Breakdown da infração por SETOR (um motivo hoje: jornada acima do limite).
  WITH infra AS (
    SELECT COALESCE(NULLIF(btrim(d.department),''),'(sem depto)') AS setor, count(*) AS qtd
    FROM ind_ponto_dia d
    WHERE d.company_id = p_company_id AND d.data BETWEEN v_ini AND v_fim
      AND (p_departamento IS NULL OR d.department = p_departamento)
      AND COALESCE(d.worked_seconds,0) > v_limite_seg
    GROUP BY 1
  )
  SELECT COALESCE(sum(qtd),0)::int,
         COALESCE(jsonb_agg(jsonb_build_object('setor', setor, 'motivo', v_motivo, 'qtd', qtd)
                            ORDER BY qtd DESC, setor), '[]'::jsonb)
  INTO v_infra_total, v_infra_por_setor
  FROM infra;

  RETURN jsonb_build_object(
    'ok', true, 'ano', p_ano, 'mes', p_mes, 'jornada_h', p_jornada_h,
    'limite_dia_h', v_limite_h,
    'dias_uteis', v_dias_uteis,
    'tem_dados', (SELECT EXISTS (SELECT 1 FROM ind_ponto_dia WHERE company_id=p_company_id AND data BETWEEN v_ini AND v_fim)),
    'infracoes_total', v_infra_total,
    'infracoes_por_motivo',
      CASE WHEN v_infra_total > 0
        THEN jsonb_build_array(jsonb_build_object('motivo', v_motivo, 'qtd', v_infra_total))
        ELSE '[]'::jsonb END,
    'infracoes_por_setor', v_infra_por_setor,
    'por_colaborador', v_por_colab, 'por_dia', v_por_dia);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_ponto_bi_dia(uuid,integer,integer,text,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_dia(uuid,integer,integer,text,numeric,numeric) TO authenticated, service_role;

-- 2) Dias do colaborador + motivo da infração por dia --------------------------------
CREATE OR REPLACE FUNCTION public.fn_ponto_bi_colaborador_dias(p_company_id uuid, p_cpf text, p_ano integer, p_mes integer, p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_limite_h numeric := round(v_limite_seg/3600.0, 1);
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
    'motivo_infracao', CASE WHEN COALESCE(d.worked_seconds,0) > v_limite_seg
                            THEN 'Jornada acima do limite diário (' || v_limite_h || 'h)'
                            ELSE NULL END,
    'shift', d.shift
  ) ORDER BY d.data), '[]'::jsonb)
  INTO v_dias
  FROM ind_ponto_dia d
  WHERE d.company_id = p_company_id AND d.cpf = p_cpf AND d.data BETWEEN v_ini AND v_fim;
  RETURN jsonb_build_object('ok', true, 'cpf', p_cpf, 'ano', p_ano, 'mes', p_mes, 'dias', v_dias);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_ponto_bi_colaborador_dias(uuid,text,integer,integer,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_colaborador_dias(uuid,text,integer,integer,numeric,numeric) TO authenticated, service_role;

-- 3) RD-95: "?" do novo bloco "Infrações por motivo" --------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ponto.infra.por_motivo', '/dashboard/industrial/ponto', 'Painel por dia',
   'Infrações por motivo',
   'Indicador (não se preenche): mostra quantas infrações de jornada houve no mês, por motivo e por setor.',
   'Hoje a regra de infração é uma só — dia trabalhado acima do limite diário de jornada. O bloco totaliza essas ocorrências no geral e as distribui por setor, para você ver onde se concentram.',
   'Jornada acima do limite diário: 1.827 — sendo ABATE 540, DESOSSA 410, EXPEDIÇÃO 300…',
   'Confundir "além da escala" (horas acima do turno, operacional) com infração de jornada (dia acima do limite diário).',
   'gestao_empresarial', 10)
ON CONFLICT (chave) DO NOTHING;
