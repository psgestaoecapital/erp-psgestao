-- Revenda R3a · A CONTA DO CARRO (carrego, lucro real, sangria, vira prejuízo) — banco.
-- Base pronta: fn_veic_carrego_parametros (ocupação R$/dia, capital %/dia, depreciação por fonte).
-- RD-51: nunca 0 fingindo cálculo — componente sem dado vem NULL + status ('nao_configurado'|'travado_d7').
-- RD-65: fonte única — reusa fn_veic_preco_minimo (preço mínimo, piso, encargos, custo total). Nenhuma
-- tela recalcula carrego/lucro/ROI: tudo sai destas funções. Guarda de empresa (fn_veic_acesso), sem anon.

-- ── fn_veic_carrego(veiculo) → carrego por veículo, 3 componentes + status ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_carrego(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v record; v_venda date; v_dias int; v_custos numeric; v_base numeric;
  v_par jsonb; v_ocup_dia numeric; v_cap_dia_pct numeric; v_deprec jsonb; v_deprec_fonte text;
  v_cap_dia numeric; v_deprec_dia numeric; v_pct_ano numeric;
  v_ocupacao numeric; v_capital numeric; v_deprec_valor numeric;
  v_ocup_status text; v_cap_status text; v_deprec_status text;
  v_total numeric; v_total_status text; v_sangria_dia numeric; v_sangria_status text;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, data_entrada, valor_aquisicao INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  -- dias parado: da entrada até hoje, ou até a venda (última venda não excluída)
  SELECT data_venda INTO v_venda FROM veic_venda
    WHERE veiculo_id = p_veiculo_id AND deleted_at IS NULL AND data_venda IS NOT NULL
    ORDER BY data_venda DESC LIMIT 1;
  v_dias := CASE WHEN v.data_entrada IS NULL THEN NULL
                 ELSE GREATEST((COALESCE(v_venda, current_date) - v.data_entrada), 0) END;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c
    WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_base := COALESCE(v.valor_aquisicao,0) + v_custos;   -- capital investido no veículo

  v_par := fn_veic_carrego_parametros(v.company_id);
  v_ocup_dia    := NULLIF(v_par->>'ocupacao_dia','')::numeric;
  v_cap_dia_pct := NULLIF(v_par->>'capital_dia_pct','')::numeric;   -- % ao DIA sobre o capital parado
  v_deprec      := v_par->'depreciacao';
  v_deprec_fonte := v_deprec->>'fonte';

  -- OCUPAÇÃO = R$/dia × dias
  IF v_dias IS NULL OR v_ocup_dia IS NULL THEN v_ocupacao := NULL; v_ocup_status := 'nao_configurado';
  ELSE v_ocupacao := round(v_ocup_dia * v_dias, 2); v_ocup_status := 'ok'; END IF;

  -- CAPITAL = base × (%dia/100) × dias
  v_cap_dia := CASE WHEN v_cap_dia_pct IS NOT NULL AND v_base > 0 THEN v_base * v_cap_dia_pct/100.0 ELSE NULL END;
  IF v_dias IS NULL OR v_cap_dia IS NULL THEN v_capital := NULL; v_cap_status := 'nao_configurado';
  ELSE v_capital := round(v_cap_dia * v_dias, 2); v_cap_status := 'ok'; END IF;

  -- DEPRECIAÇÃO por fonte: fipe travado (D7); curva_propria usa pct_ano da curva; nao_calcular = 0 honesto
  IF v_deprec_fonte = 'fipe' THEN
    v_deprec_valor := NULL; v_deprec_dia := NULL; v_deprec_status := 'travado_d7';
  ELSIF v_deprec_fonte = 'curva_propria' THEN
    v_pct_ano := NULLIF(v_deprec->'curva'->>'pct_ano','')::numeric;
    IF v_pct_ano IS NOT NULL AND v_dias IS NOT NULL AND v_base > 0 THEN
      v_deprec_dia   := v_base * v_pct_ano/100.0/365.0;
      v_deprec_valor := round(v_deprec_dia * v_dias, 2); v_deprec_status := 'ok';
    ELSE v_deprec_valor := NULL; v_deprec_dia := NULL; v_deprec_status := 'nao_configurado'; END IF;
  ELSE  -- nao_calcular: escolha explícita do dono (não é lacuna) → 0 honesto
    v_deprec_valor := 0; v_deprec_dia := 0; v_deprec_status := 'nao_calcular';
  END IF;

  -- TOTAL = soma dos componentes computáveis; status agregado (parcial se faltar dado)
  v_total := COALESCE(v_ocupacao,0) + COALESCE(v_capital,0) + COALESCE(v_deprec_valor,0);
  v_total_status := CASE WHEN v_ocup_status='ok' AND v_cap_status='ok'
                          AND v_deprec_status IN ('ok','nao_calcular') THEN 'ok' ELSE 'parcial' END;

  -- SANGRIA/DIA = carrego do dia (soma dos componentes diários computáveis)
  v_sangria_dia := COALESCE(v_ocup_dia,0) + COALESCE(v_cap_dia,0) + COALESCE(v_deprec_dia,0);
  v_sangria_status := CASE WHEN v_ocup_status='ok' AND v_cap_status='ok'
                            AND v_deprec_status IN ('ok','nao_calcular') THEN 'ok' ELSE 'parcial' END;

  RETURN jsonb_build_object(
    'ok', true, 'veiculo_id', p_veiculo_id, 'dias_parado', v_dias, 'capital_investido', v_base,
    'ocupacao',    jsonb_build_object('valor', v_ocupacao,    'status', v_ocup_status,   'por_dia', v_ocup_dia),
    'capital',     jsonb_build_object('valor', v_capital,     'status', v_cap_status,    'por_dia', round(v_cap_dia, 4)),
    'depreciacao', jsonb_build_object('valor', v_deprec_valor,'status', v_deprec_status, 'por_dia', round(v_deprec_dia, 4), 'fonte', v_deprec_fonte),
    'total', round(v_total, 2), 'total_status', v_total_status,
    'sangria_dia', round(v_sangria_dia, 2), 'sangria_status', v_sangria_status
  );
END $function$;

-- ── fn_veic_conta_do_carro(veiculo) → a faixa da ficha, em uma chamada ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_conta_do_carro(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v record; v_pm jsonb; v_carrego jsonb;
  v_aquisicao numeric; v_custos numeric; v_previsao numeric; v_custo_precif numeric;
  v_enc_soma numeric; v_enc_frac numeric; v_preco_min numeric; v_piso numeric;
  v_carrego_total numeric; v_custo_real numeric; v_anunciado numeric;
  v_lucro numeric; v_base numeric; v_dias int; v_roi numeric; v_sangria_dia numeric; v_vira date;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, marca, modelo, placa, preco_venda INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  v_pm      := fn_veic_preco_minimo(p_veiculo_id);   -- fonte única (RD-65)
  v_carrego := fn_veic_carrego(p_veiculo_id);

  v_aquisicao    := NULLIF(v_pm->'custo'->>'aquisicao','')::numeric;
  v_custos       := NULLIF(v_pm->'custo'->>'custos_lancados','')::numeric;
  v_previsao     := NULLIF(v_pm->'custo'->>'previsao_gastos','')::numeric;
  v_custo_precif := NULLIF(v_pm->'custo'->>'custo_total','')::numeric;   -- aquisição + custos + previsão
  v_enc_soma     := NULLIF(v_pm->'encargos_pct'->>'soma','')::numeric;   -- % (impostos+comissão+garantia)
  v_preco_min    := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso         := NULLIF(v_pm->>'piso_sem_margem','')::numeric;
  v_carrego_total := NULLIF(v_carrego->>'total','')::numeric;
  v_sangria_dia  := NULLIF(v_carrego->>'sangria_dia','')::numeric;
  v_dias         := NULLIF(v_carrego->>'dias_parado','')::int;
  v_base         := NULLIF(v_carrego->>'capital_investido','')::numeric;

  v_enc_frac  := COALESCE(v_enc_soma,0)/100.0;
  v_custo_real := COALESCE(v_custo_precif,0) + COALESCE(v_carrego_total,0);   -- inclui o carrego
  v_anunciado := v.preco_venda;

  -- lucro real projetado = anunciado − custo real − encargos sobre o preço
  v_lucro := CASE WHEN v_anunciado IS NULL THEN NULL
                  ELSE round(v_anunciado * (1 - v_enc_frac) - v_custo_real, 2) END;
  -- ROI anualizado (%) = lucro / capital investido × 365/dias
  v_roi := CASE WHEN v_lucro IS NOT NULL AND COALESCE(v_base,0) > 0 AND COALESCE(v_dias,0) > 0
                THEN round(v_lucro / v_base * 365.0 / v_dias * 100, 2) ELSE NULL END;
  -- data em que o lucro projetado zera mantendo o anunciado (o carrego cresce sangria_dia/dia)
  v_vira := CASE WHEN v_lucro IS NOT NULL AND v_lucro > 0 AND COALESCE(v_sangria_dia,0) > 0
                 THEN current_date + floor(v_lucro / v_sangria_dia)::int ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'comprei', v_aquisicao,
    'custos_lancados', v_custos,
    'previsao_vistoria', v_previsao,
    'sobrepreco_troca', jsonb_build_object('valor', NULL, 'status', 'nao_rastreado'),  -- não modelado na aquisição
    'carrego', v_carrego,
    'custo_real_total', round(v_custo_real, 2),
    'piso_sem_margem', v_piso,
    'preco_minimo', v_preco_min,
    'anunciado', v_anunciado,
    'lucro_real_projetado', v_lucro,
    'roi_anualizado_pct', v_roi,
    'capital_investido', v_base,
    'dias_parado', v_dias,
    'sangria_dia', v_sangria_dia,
    'data_vira_prejuizo', v_vira,
    'encargos_pct', v_enc_soma
  );
END $function$;

-- ── fn_veic_patio_conta(company) → painel + pátio, em uma chamada ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_patio_conta(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record; conta jsonb; carrego jsonb;
  v_sangria_total numeric := 0; v_capital_parado numeric := 0;
  v_itens jsonb := '[]'::jsonb; v_vira jsonb := '[]'::jsonb;
  v_enc_soma numeric; v_enc_frac numeric; v_custo_fixo jsonb; v_cf numeric;
  v_lucro_mes numeric := 0; v_vendas_mes int := 0;
  v_lucro_realizado numeric; v_carrego_total numeric; v_custo_real numeric;
  v_margem_media numeric; v_carros_neces numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT impostos_venda_pct + comissao_venda_pct + provisao_garantia_pct
    INTO v_enc_soma FROM veic_config WHERE company_id = p_company_id;  -- pode ser NULL se algum não config
  SELECT (COALESCE(impostos_venda_pct,0)+COALESCE(comissao_venda_pct,0)+COALESCE(provisao_garantia_pct,0))
    INTO v_enc_frac FROM veic_config WHERE company_id = p_company_id;
  v_enc_frac := COALESCE(v_enc_frac,0)/100.0;
  v_custo_fixo := fn_veic_custo_fixo_rateavel(p_company_id);
  v_cf := NULLIF(v_custo_fixo->>'valor','')::numeric;

  -- VEÍCULOS NO PÁTIO (não vendidos/entregues): sangria, capital parado, ranking ROI, vira-prejuízo 30d
  FOR r IN
    SELECT id, modelo, placa FROM veic_veiculo
    WHERE company_id = p_company_id AND deleted_at IS NULL AND situacao NOT IN ('vendido','entregue')
  LOOP
    conta := fn_veic_conta_do_carro(r.id);
    IF (conta->>'ok')::boolean IS NOT TRUE THEN CONTINUE; END IF;
    v_sangria_total  := v_sangria_total + COALESCE(NULLIF(conta->>'sangria_dia','')::numeric, 0);
    v_capital_parado := v_capital_parado + COALESCE(NULLIF(conta->>'capital_investido','')::numeric, 0);
    v_itens := v_itens || jsonb_build_object(
      'veiculo_id', r.id, 'modelo', r.modelo, 'placa', r.placa,
      'roi_anualizado_pct', conta->'roi_anualizado_pct', 'lucro_real_projetado', conta->'lucro_real_projetado',
      'sangria_dia', conta->'sangria_dia', 'data_vira_prejuizo', conta->'data_vira_prejuizo');
    IF conta->>'data_vira_prejuizo' IS NOT NULL
       AND (conta->>'data_vira_prejuizo')::date <= current_date + 30 THEN
      v_vira := v_vira || jsonb_build_object('veiculo_id', r.id, 'modelo', r.modelo, 'placa', r.placa,
        'data_vira_prejuizo', conta->>'data_vira_prejuizo', 'quanto_falta', conta->'lucro_real_projetado');
    END IF;
  END LOOP;

  -- LUCRO REAL DO MÊS (vendas faturadas/entregues do mês corrente): valor − custo real − encargos
  FOR r IN
    SELECT vd.veiculo_id, vd.valor_venda,
      COALESCE(vv.valor_aquisicao,0) AS aquisicao,
      (SELECT COALESCE(sum(c.valor),0) FROM veic_custo c WHERE c.veiculo_id=vv.id AND c.deleted_at IS NULL) AS custos,
      (SELECT iv.previsao_total FROM insp_vistoria iv WHERE iv.alvo_tabela='veic_veiculo' AND iv.alvo_id=vv.id AND iv.situacao='concluida' ORDER BY iv.concluida_em DESC LIMIT 1) AS previsao
    FROM veic_venda vd JOIN veic_veiculo vv ON vv.id = vd.veiculo_id
    WHERE vd.company_id = p_company_id AND vd.deleted_at IS NULL AND vd.situacao IN ('faturada','entregue')
      AND date_trunc('month', vd.data_venda) = date_trunc('month', current_date)
  LOOP
    carrego := fn_veic_carrego(r.veiculo_id);
    v_carrego_total := COALESCE(NULLIF(carrego->>'total','')::numeric, 0);
    v_custo_real := r.aquisicao + r.custos + COALESCE(r.previsao,0) + v_carrego_total;
    v_lucro_realizado := round(COALESCE(r.valor_venda,0) * (1 - v_enc_frac) - v_custo_real, 2);
    v_lucro_mes := v_lucro_mes + v_lucro_realizado;
    v_vendas_mes := v_vendas_mes + 1;
  END LOOP;

  -- PONTO DE EQUILÍBRIO = custo fixo mensal ÷ margem média realizada (R$ por carro)
  v_margem_media := CASE WHEN v_vendas_mes > 0 THEN v_lucro_mes / v_vendas_mes ELSE NULL END;
  v_carros_neces := CASE WHEN v_cf IS NOT NULL AND v_margem_media IS NOT NULL AND v_margem_media > 0
                         THEN ceil(v_cf / v_margem_media) ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true, 'company_id', p_company_id,
    'sangria_dia_total', round(v_sangria_total, 2),
    'sangria_30d', round(v_sangria_total * 30, 2),
    'capital_parado', round(v_capital_parado, 2),
    'lucro_real_mes', round(v_lucro_mes, 2),
    'vendas_mes', v_vendas_mes,
    'encargos_configurados', (v_enc_soma IS NOT NULL),
    'ponto_equilibrio', jsonb_build_object(
      'carros_necessarios', v_carros_neces, 'vendidos', v_vendas_mes,
      'status', CASE WHEN v_carros_neces IS NULL THEN 'nao_configurado' ELSE 'ok' END),
    -- lista COMPLETA dos veículos do pátio (sangria/dia, vira-prejuízo, ROI por veículo) — o pátio (R3c)
    -- casa por veiculo_id; o ranking abaixo é só uma fatia dela.
    'itens', v_itens,
    'vira_prejuizo_30d', (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'data_vira_prejuizo')), '[]'::jsonb)
                          FROM jsonb_array_elements(v_vira) e),
    'ranking_roi_melhores', (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
        SELECT e FROM jsonb_array_elements(v_itens) e
        WHERE (e->>'roi_anualizado_pct') IS NOT NULL
        ORDER BY (e->>'roi_anualizado_pct')::numeric DESC LIMIT 5) t),
    'ranking_roi_piores', (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
        SELECT e FROM jsonb_array_elements(v_itens) e
        WHERE (e->>'roi_anualizado_pct') IS NOT NULL
        ORDER BY (e->>'roi_anualizado_pct')::numeric ASC LIMIT 5) t)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_carrego(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_conta_do_carro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_patio_conta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_carrego(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_conta_do_carro(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_patio_conta(uuid) TO authenticated, service_role;
