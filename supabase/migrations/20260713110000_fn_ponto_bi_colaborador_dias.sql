-- ============================================================
-- PONTO GRANULAR · drill-down NÍVEL 2 (Colaborador → Dias do mês).
--
-- fn_ponto_bi_dia (L1) dá o resumo do mês por colaborador e a série por dia.
-- fn_ponto_bi_marcacoes (L3) dá as batidas de um colaborador num dia.
-- Faltava o meio: os DIAS de UM colaborador no mês — esta função. Assim o
-- painel abre Colaborador → lista de dias (com horas/extras/infração/ajuste) →
-- clicando o dia, as batidas. LGPD: nome fica em ind_ponto_colaborador; aqui só cpf.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_ponto_bi_colaborador_dias(
  p_company_id uuid, p_cpf text, p_ano int, p_mes int,
  p_jornada_h numeric DEFAULT 8, p_limite_dia_h numeric DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_jornada_seg numeric := GREATEST(p_jornada_h, 0.01) * 3600;
  v_limite_seg numeric := GREATEST(p_limite_dia_h, p_jornada_h) * 3600;
  v_dias jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'data', d.data,
    'horas', round(COALESCE(d.worked_seconds,0)/3600.0, 2),
    'extras', round(GREATEST(COALESCE(d.worked_seconds,0) - v_jornada_seg, 0)/3600.0, 2),
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

GRANT EXECUTE ON FUNCTION public.fn_ponto_bi_colaborador_dias(uuid, text, int, int, numeric, numeric) TO authenticated;
