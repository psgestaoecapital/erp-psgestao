-- ==========================================================
-- FINANCIAMENTOS · recalculo (PRICE + 'informada' vs 'calculada')
-- ==========================================================

-- 1A. coluna que distingue parcela calculada vs digitada pelo usuario
ALTER TABLE public.financiamentos
  ADD COLUMN IF NOT EXISTS valor_parcela_origem text;  -- 'calculada' | 'informada'

-- 1B. RPC de recalculo de UM contrato
CREATE OR REPLACE FUNCTION public.fn_financiamento_recalcular(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f RECORD;
  v_i numeric; v_n int; v_pv numeric; v_pmt numeric;
  v_pagas int; v_parcela numeric; v_saldo_parc numeric; v_amort numeric;
BEGIN
  SELECT * INTO f FROM financiamentos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Financiamento nao encontrado');
  END IF;
  IF f.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissao para esta empresa');
  END IF;

  v_i  := COALESCE(f.taxa_mensal,0) / 100.0;
  v_n  := COALESCE(f.parcelas, 0);
  v_pv := COALESCE(NULLIF(f.valor_liquido,0), f.valor_original, 0);

  -- parcelas pagas (derivacao segura)
  v_pagas := GREATEST(COALESCE(f.parcelas,0) - COALESCE(f.parcelas_restantes,0), 0);

  -- valor da parcela: respeita 'informada'; senao calcula PRICE
  IF COALESCE(f.valor_parcela_origem,'calculada') = 'informada' AND COALESCE(f.valor_parcela,0) > 0 THEN
    v_parcela := f.valor_parcela;
  ELSIF UPPER(COALESCE(f.sistema_amortizacao,'PRICE')) = 'PRICE' AND v_i > 0 AND v_n > 0 AND v_pv > 0 THEN
    v_pmt := v_pv * v_i * power(1+v_i, v_n) / (power(1+v_i, v_n) - 1);
    v_parcela := round(v_pmt, 2);
  ELSIF v_n > 0 AND v_pv > 0 THEN
    v_parcela := round(v_pv / v_n + v_pv * v_i / 2, 2);  -- fallback SAC/sem juros aprox
  ELSE
    v_parcela := COALESCE(f.valor_parcela, 0);
  END IF;

  v_saldo_parc := round(v_parcela * GREATEST(COALESCE(f.parcelas_restantes,0),0), 2);
  v_amort      := GREATEST(COALESCE(f.valor_original,0) - COALESCE(f.saldo_devedor,0), 0);

  UPDATE financiamentos SET
    parcelas_pagas       = v_pagas,
    valor_parcela        = v_parcela,
    valor_parcela_origem = COALESCE(valor_parcela_origem,'calculada'),
    saldo_total_parcelas = v_saldo_parc,
    valor_amortizado     = v_amort
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'parcelas_pagas', v_pagas,
    'valor_parcela', v_parcela, 'saldo_total_parcelas', v_saldo_parc,
    'valor_amortizado', v_amort);
END;
$$;

-- 1C. RPC pra recalcular todos os contratos de uma empresa (botao "Recalcular todos")
CREATE OR REPLACE FUNCTION public.fn_financiamento_recalcular_empresa(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; v_qtd int := 0;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissao');
  END IF;
  FOR r IN SELECT id FROM financiamentos WHERE company_id = p_company_id LOOP
    PERFORM fn_financiamento_recalcular(r.id);
    v_qtd := v_qtd + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'recalculados', v_qtd);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_financiamento_recalcular(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_financiamento_recalcular_empresa(uuid) TO authenticated;
