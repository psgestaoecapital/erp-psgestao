-- ==========================================================
-- FINANCIAMENTOS · Cronograma (PRICE/SAC/sem juros) idempotente
-- ==========================================================

CREATE OR REPLACE FUNCTION public.fn_financiamento_gerar_cronograma(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  f RECORD;
  v_i numeric; v_n int; v_pv numeric; v_parcela numeric;
  v_saldo numeric; v_juros numeric; v_amort numeric; v_amort_sac numeric;
  v_venc date; v_base date; k int; v_status text; v_sac boolean;
BEGIN
  SELECT * INTO f FROM financiamentos WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','Financiamento nao encontrado'); END IF;
  IF f.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao'); END IF;

  v_i  := COALESCE(f.taxa_mensal,0)/100.0;
  v_n  := COALESCE(f.parcelas,0);
  v_pv := COALESCE(NULLIF(f.valor_liquido,0), f.valor_original, 0);
  IF v_n <= 0 OR v_pv <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','Dados insuficientes (parcelas/valor)'); END IF;

  v_sac  := UPPER(COALESCE(f.sistema_amortizacao,'PRICE')) = 'SAC';
  v_base := COALESCE(f.data_primeira_parcela, f.data_liberacao, CURRENT_DATE);

  -- regenera (idempotente)
  DELETE FROM financiamento_parcelas WHERE financiamento_id = p_id;

  v_saldo := v_pv;
  IF NOT v_sac AND v_i > 0 THEN
    v_parcela := round(v_pv * v_i * power(1+v_i,v_n)/(power(1+v_i,v_n)-1), 2);  -- PRICE
  ELSIF v_sac THEN
    v_amort_sac := round(v_pv / v_n, 2);                                        -- SAC
  ELSE
    v_parcela := round(v_pv / v_n, 2);                                          -- sem juros
  END IF;

  FOR k IN 1..v_n LOOP
    v_venc := (v_base + ((k-1) || ' months')::interval)::date;
    IF v_sac THEN
      v_amort   := v_amort_sac;
      v_juros   := round(v_saldo * v_i, 2);
      v_parcela := round(v_amort + v_juros, 2);
    ELSIF v_i > 0 THEN
      v_juros := round(v_saldo * v_i, 2);
      v_amort := round(v_parcela - v_juros, 2);
    ELSE
      v_juros := 0; v_amort := v_parcela;
    END IF;
    v_saldo := round(v_saldo - v_amort, 2);
    IF k = v_n THEN v_saldo := 0; END IF;  -- zera resto do arredondamento na ultima
    v_status := CASE WHEN k <= COALESCE(f.parcelas_pagas,0) THEN 'paga' ELSE 'aberta' END;

    INSERT INTO financiamento_parcelas
      (financiamento_id, company_id, numero, data_vencimento, valor_parcela,
       amortizacao, juros, saldo_apos, status, tipo, desconto_adimplencia)
    VALUES
      (p_id, f.company_id, k, v_venc, v_parcela, v_amort, v_juros,
       GREATEST(v_saldo,0), v_status, 'amortizacao', 0);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'parcelas_geradas',v_n,'sistema',
    CASE WHEN v_sac THEN 'SAC' WHEN v_i>0 THEN 'PRICE' ELSE 'SEM_JUROS' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_financiamento_gerar_cronograma_empresa(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD; v int := 0;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao'); END IF;
  FOR r IN SELECT id FROM financiamentos WHERE company_id = p_company_id LOOP
    PERFORM fn_financiamento_gerar_cronograma(r.id); v := v + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'contratos',v);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_financiamento_gerar_cronograma(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_financiamento_gerar_cronograma_empresa(uuid) TO authenticated;
