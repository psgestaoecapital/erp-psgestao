-- Hub · custos fixos com rateio automático por m² entre as obras (plantão 43aaedf9, item 2b).
-- Aditiva e DESLIGADA por padrão (RD-97): coluna nova de área na obra, chave de liga/desliga por empresa e uma função
-- nova. Só escreve linhas próprias em projetos_obra_rateio (marcadas na descrição), que a v_obra_resultado_alocado já soma.
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS area_m2 numeric(14,2);
ALTER TABLE public.rateio_config_empresa ADD COLUMN IF NOT EXISTS rateio_obra_m2_ativo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_obra_rateio_m2_aplicar(p_company_id uuid, p_competencia date, p_valor_total numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp date; v_marca text; v_area numeric; v_n int; v_resto numeric; v_ultimo uuid; v_soma numeric := 0;
        r record; v_val numeric;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para ratear o custo fixo.');
  END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.');
  END IF;
  IF p_valor_total IS NULL OR p_valor_total < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o valor total do custo fixo do mês (zero ou mais).');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rateio_config_empresa WHERE company_id = p_company_id AND rateio_obra_m2_ativo) THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false,
      'motivo', 'Rateio por m² entre obras está desligado para esta empresa. Nada rateado.');
  END IF;
  v_comp := date_trunc('month', p_competencia)::date;
  v_marca := 'Rateio automático por m² · ' || to_char(v_comp, 'MM/YYYY');

  SELECT COALESCE(SUM(area_m2), 0), count(*) INTO v_area, v_n
  FROM projetos_obras WHERE company_id = p_company_id AND status = 'em_andamento' AND COALESCE(area_m2, 0) > 0;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false,
      'motivo', 'Nenhuma obra em andamento com área em m² preenchida. Nada rateado.');
  END IF;

  -- Recalcular o mês é seguro: troca só as linhas automáticas anteriores deste mês (as lançadas à mão ficam).
  UPDATE projetos_obra_rateio SET excluido_em = now()
   WHERE company_id = p_company_id AND competencia = v_comp AND descricao = v_marca AND excluido_em IS NULL;

  SELECT id INTO v_ultimo FROM projetos_obras
   WHERE company_id = p_company_id AND status = 'em_andamento' AND COALESCE(area_m2, 0) > 0
   ORDER BY area_m2 DESC, id LIMIT 1;
  FOR r IN SELECT id, area_m2 FROM projetos_obras
            WHERE company_id = p_company_id AND status = 'em_andamento' AND COALESCE(area_m2, 0) > 0 ORDER BY id LOOP
    IF r.id = v_ultimo THEN CONTINUE; END IF;
    v_val := ROUND(p_valor_total * r.area_m2 / v_area, 2);
    INSERT INTO projetos_obra_rateio (company_id, obra_id, competencia, descricao, valor, criado_por)
    VALUES (p_company_id, r.id, v_comp, v_marca, v_val, auth.uid());
    v_soma := v_soma + v_val;
  END LOOP;
  v_resto := ROUND(p_valor_total - v_soma, 2);   -- a maior obra absorve o centavo de arredondamento
  INSERT INTO projetos_obra_rateio (company_id, obra_id, competencia, descricao, valor, criado_por)
  VALUES (p_company_id, v_ultimo, v_comp, v_marca, v_resto, auth.uid());

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'projetos_obra_rateio', p_company_id::text, 'rateio_m2_aplicar', NULL,
          jsonb_build_object('competencia', v_comp, 'valor_total', p_valor_total, 'obras', v_n, 'area_total_m2', v_area));
  RETURN jsonb_build_object('ok', true, 'aplicado', true, 'competencia', v_comp,
                            'valor_total', p_valor_total, 'obras', v_n, 'area_total_m2', v_area);
END $function$;
REVOKE ALL ON FUNCTION public.fn_obra_rateio_m2_aplicar(uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rateio_m2_aplicar(uuid, date, numeric) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_rateio_m2_aplicar(uuid, date, numeric) IS
  'Hub · reparte o custo fixo do mês entre as obras em andamento proporcional à área (m²). Desligado por padrão (rateio_config_empresa.rateio_obra_m2_ativo). Idempotente por mês.';
