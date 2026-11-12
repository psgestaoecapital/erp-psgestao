-- Conserto de bug (RD-38 provado no dado): fn_prod_posto_custo_hora_interno montava o aviso de
-- "falta" com `v_falta (text[]) || 'literal de texto'`, que o Postgres resolve como
-- array || array e QUEBRA com 22P02 "malformed array literal" quando falta horas de operação
-- ou mão de obra sem salário. Prova: SELECT ('{}'::text[]) || 'horas ...' -> ERRO 22P02.
-- Correção cirúrgica: usar ARRAY['...'] nas duas concatenações. Nenhuma outra regra muda —
-- k-anonimato (k<3 protege MO), origem do custo, energia/utilidades e custo_hora idênticos.
CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_hora_interno(p_posto_id uuid, p_ref date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c prod_posto_custo%ROWTYPE; v_mo numeric; v_mo_origem text; v_energia numeric; v_total numeric; v_horas numeric; v_falta text[] := '{}';
        v_nom int; v_tur int; v_n int; v_prot boolean;
BEGIN
  SELECT * INTO c FROM prod_posto_custo
   WHERE posto_id = p_posto_id AND deleted_at IS NULL AND vigencia_inicio <= p_ref AND (vigencia_fim IS NULL OR vigencia_fim >= p_ref)
   ORDER BY vigencia_inicio DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tem_custo', false, 'falta', jsonb_build_array('custo do posto não cadastrado'));
  END IF;
  IF c.mao_obra_mes IS NOT NULL THEN
    v_mo := c.mao_obra_mes * (1 + c.encargos_pct/100.0); v_mo_origem := 'manual';
  ELSE
    SELECT sum(sb.valor) INTO v_mo FROM prod_posto_pessoa pp
      JOIN LATERAL (SELECT valor FROM prod_salario_base s WHERE s.funcionario_id = pp.funcionario_id
                    AND s.vigencia_inicio <= p_ref AND (s.vigencia_fim IS NULL OR s.vigencia_fim >= p_ref)
                    ORDER BY s.vigencia_inicio DESC LIMIT 1) sb ON true
     WHERE pp.posto_id = p_posto_id AND pp.vigencia_inicio <= p_ref AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= p_ref);
    IF v_mo IS NOT NULL THEN v_mo := v_mo * (1 + c.encargos_pct/100.0); v_mo_origem := 'cargo_salario_base'; END IF;
  END IF;
  -- nº de pessoas do posto (nominal vigente e quadro por turno); o menor valor conhecido decide — na dúvida, protege
  SELECT count(*) INTO v_nom FROM prod_posto_pessoa pp
   WHERE pp.posto_id = p_posto_id AND pp.vigencia_inicio <= p_ref AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= p_ref);
  SELECT sum(t.pessoas)::int INTO v_tur FROM prod_posto_turno t
   WHERE t.posto_id = p_posto_id AND t.vigencia_inicio <= p_ref AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= p_ref);
  v_n := LEAST(COALESCE(NULLIF(v_nom,0), 2147483647), COALESCE(NULLIF(v_tur,0), 2147483647));
  v_prot := (v_n = 2147483647 OR v_n < 3);
  IF v_prot THEN
    v_mo := NULL; v_mo_origem := NULL;
  ELSIF v_mo IS NULL THEN
    v_falta := v_falta || ARRAY['mão de obra sem salário base ou valor informado'];
  END IF;
  v_energia := coalesce(c.energia_mes, c.energia_kwh_mes * c.energia_tarifa_kwh);
  v_total := coalesce(v_mo,0) + coalesce(v_energia,0) + coalesce(c.agua_mes,0) + coalesce(c.vapor_mes,0)
           + coalesce(c.frio_mes,0) + coalesce(c.ar_comprimido_mes,0) + coalesce(c.outros_mes,0);
  v_horas := c.horas_operacao_mes;
  IF v_horas IS NULL THEN v_falta := v_falta || ARRAY['horas de operação por mês não informadas']; END IF;
  RETURN jsonb_build_object('tem_custo', true, 'vigencia_inicio', c.vigencia_inicio,
    'mao_obra_protegida', v_prot, 'mao_obra_mes', v_mo, 'mao_obra_origem', v_mo_origem, 'energia_mes', v_energia,
    'utilidades_mes', coalesce(c.agua_mes,0)+coalesce(c.vapor_mes,0)+coalesce(c.frio_mes,0)+coalesce(c.ar_comprimido_mes,0),
    'outros_mes', c.outros_mes, 'total_mes', v_total, 'horas_operacao_mes', v_horas,
    'custo_hora', CASE WHEN v_horas > 0 THEN round(v_total / v_horas, 4) END, 'falta', to_jsonb(v_falta));
END $function$;

-- ACL viva preservada (check-fn-guards): só postgres (owner) e service_role; anon/PUBLIC sem EXECUTE.
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_hora_interno(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_hora_interno(uuid, date) TO service_role;
