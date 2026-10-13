-- Revenda · carro CONSIGNADO não tem precificação, só valor de venda (chamado Alliance #115, Fábio).
--
-- "CAMPO CONSIGNADO — NÃO PRECISA PRECIFICAÇÃO APENAS VALOR DE VENDA". Carro consignado (origem =
-- 'consignacao') não foi comprado pela loja: não há custo de aquisição e o dono só define o valor de venda.
-- Nenhuma função de preço/custo lia `origem`, então o consignado era tratado como carro comprado com custo 0:
--   · fn_veic_preco_minimo  → preco_minimo NULL + flags sem_custo_aquisicao/piso_incompleto (a tela cobrava
--                             "informe a aquisição");
--   · fn_veic_conta_do_carro → projetava o valor de venda INTEIRO como lucro (ex.: R$ 86.000), ROI anualizado
--                             absurdo e "vira prejuízo" no ano 4689;
--   · fn_veic_precificacao_salvar → gravava preco_minimo = custo + encargos = 0 ("piso R$ 0,00" no pátio);
--   · fn_veic_patio_conta   → na venda de um consignado, somaria o valor da venda inteiro no lucro do mês.
--
-- Regra nova (só para origem = 'consignacao'; os demais carros seguem EXATAMENTE a conta de antes — o JSON
-- de saída deles não muda, a marca `consignado` só é acrescentada quando o carro é consignado):
--   1) fn_veic_preco_minimo: preco_minimo/piso NULL, sem os flags sem_custo_aquisicao/piso_incompleto,
--      com `consignado: true` (no topo e em flags);
--   2) fn_veic_precificacao_salvar: grava preco_venda; preco_minimo e margem_alvo_pct ficam NULL (veículo
--      e histórico); o retorno leva `consignado: true`;
--   3) fn_veic_conta_do_carro: lucro_real_projetado, roi_anualizado_pct e data_vira_prejuizo NULL (o valor
--      de venda não é lucro da loja) + `consignado: true`;
--   4) fn_veic_patio_conta: a venda de consignado fica fora do "lucro real do mês" (e do ponto de equilíbrio)
--      — os itens do pátio já vêm da conta do carro (3).
-- v_veic_patio não muda: tem_custo continua falso para o consignado e a TELA não trata isso como pendência.
-- Sem DML em dado de cliente: só funções. Assinaturas, SECURITY DEFINER e search_path preservados.

-- ── 1) preço mínimo ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_preco_minimo(p_veiculo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_previsao numeric; v_vist_id uuid; v_aj jsonb;
  v_custo_total numeric; v_numerador numeric; v_imp numeric; v_com_cfg numeric; v_gar numeric; v_margem numeric;
  v_soma_enc_frac numeric; v_margem_frac numeric; v_denom_min numeric; v_denom_piso numeric;
  v_preco_min numeric; v_piso numeric;
  v_com jsonb; v_com_reais numeric; v_com_pct numeric; v_com_nao boolean;
  v_consig boolean;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, margem_alvo_pct, origem
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_inexistente'); END IF;
  -- #115: consignado não tem custo de aquisição nem piso — só valor de venda
  v_consig := COALESCE(v.origem = 'consignacao', false);

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c
    WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_aj := fn_veic_previsao_vistoria_ajustada(p_veiculo_id);   -- previsão − itens recusados (RD-65)
  v_vist_id := NULLIF(v_aj->>'vistoria_id','')::uuid;
  v_previsao := NULLIF(v_aj->>'ajustada','')::numeric;
  v_custo_total := COALESCE(v.valor_aquisicao,0) + v_custos + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com_cfg, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);

  v_com       := fn_veic_comissao_precificacao(p_veiculo_id);   -- a comissão que precifica (fonte única)
  v_com_nao   := COALESCE((v_com->>'nao_config')::boolean, false);
  v_com_reais := COALESCE((v_com->>'reais')::numeric, 0);
  v_com_pct   := COALESCE((v_com->>'pct')::numeric, 0);

  v_soma_enc_frac := (COALESCE(v_imp,0) + COALESCE(v_gar,0) + v_com_pct) / 100.0;
  v_margem_frac   := COALESCE(v_margem,0) / 100.0;
  v_denom_min  := 1 - v_soma_enc_frac - v_margem_frac;
  v_denom_piso := 1 - v_soma_enc_frac;
  v_numerador  := v_custo_total + v_com_reais;

  v_preco_min := CASE WHEN NOT v_consig AND COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_min  > 0.0001 AND NOT v_com_nao
                      THEN round(v_numerador / v_denom_min, 2)  ELSE NULL END;
  v_piso      := CASE WHEN NOT v_consig AND COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_piso > 0.0001 AND NOT v_com_nao
                      THEN round(v_numerador / v_denom_piso, 2) ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'previsao_bruta', NULLIF(v_aj->>'bruta','')::numeric,
      'previsao_recusada', NULLIF(v_aj->>'recusada','')::numeric, 'custo_total', v_custo_total,
      'comissao_reais', v_com_reais, 'numerador', v_numerador),
    'encargos_pct', jsonb_build_object('impostos', v_imp, 'comissao', v_com_pct, 'garantia', v_gar,
      'soma', COALESCE(v_imp,0)+COALESCE(v_gar,0)+v_com_pct),
    'comissao', v_com,
    'margem_pct', v_margem,
    'preco_minimo', v_preco_min,
    'piso_sem_margem', v_piso,
    'detalhe', CASE WHEN v_preco_min IS NULL THEN NULL ELSE jsonb_build_object(
      'impostos_valor', round(v_preco_min * COALESCE(v_imp,0)/100, 2),
      'comissao_valor', round(v_com_reais + v_preco_min * v_com_pct/100, 2),
      'garantia_valor', round(v_preco_min * COALESCE(v_gar,0)/100, 2),
      'margem_valor',   round(v_preco_min * COALESCE(v_margem,0)/100, 2)) END,
    'flags', jsonb_build_object(
      'sem_custo_aquisicao', NOT v_consig AND COALESCE(v.valor_aquisicao,0) <= 0,
      'sem_vistoria', v_vist_id IS NULL,
      'piso_incompleto', NOT v_consig AND (v_imp IS NULL OR v_gar IS NULL OR v_com_nao),
      'sem_margem_config', v_margem IS NULL,
      'comissao_nao_configurada', v_com_nao,
      'encargos_margem_inviaveis', (v_denom_min <= 0.0001))
      || CASE WHEN v_consig THEN jsonb_build_object('consignado', true) ELSE '{}'::jsonb END)
    || CASE WHEN v_consig THEN jsonb_build_object('consignado', true) ELSE '{}'::jsonb END;
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_preco_minimo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_preco_minimo(uuid) TO authenticated, service_role;

-- ── 2) salvar precificação ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_salvar(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric;
  v_preco_venda numeric; v_margem numeric; v_preco_min numeric; v_soma_enc numeric; v_hist uuid;
  v_autor uuid := auth.uid();  -- autoria pela sessão; NULL (service_role) = sistema
  v_consig boolean;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT company_id, valor_aquisicao, origem INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  v_consig := COALESCE(v.origem = 'consignacao', false);   -- #115: consignado = só valor de venda

  BEGIN v_preco_venda := NULLIF(btrim(p_dados->>'preco_venda'),'')::numeric; EXCEPTION WHEN others THEN v_preco_venda := NULL; END;
  IF v_preco_venda IS NULL OR v_preco_venda <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'preco_venda_invalido'); END IF;
  BEGIN v_margem := NULLIF(btrim(p_dados->>'margem_alvo_pct'),'')::numeric; EXCEPTION WHEN others THEN v_margem := NULL; END;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  SELECT previsao_total INTO v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida' ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);
  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct INTO v_imp, v_com, v_gar FROM veic_config WHERE company_id = v.company_id;
  v_soma_enc := v_custo_total * (COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0))/100;
  v_preco_min := v_custo_total + v_soma_enc;
  -- consignado: não há piso nem margem sobre custo — grava só o valor de venda
  IF v_consig THEN v_preco_min := NULL; v_margem := NULL; END IF;

  UPDATE veic_veiculo
     SET preco_venda = v_preco_venda, preco_minimo = v_preco_min, margem_alvo_pct = v_margem,
         precificado_em = now(), precificado_por = v_autor, updated_at = now(), updated_by = v_autor
   WHERE id = p_veiculo_id;

  INSERT INTO veic_precificacao_hist (company_id, veiculo_id, preco_venda, preco_minimo, margem_alvo_pct,
      custo_base, previsao_gastos, impostos_pct, comissao_pct, premissas, observacao, criado_por)
  VALUES (v.company_id, p_veiculo_id, v_preco_venda, v_preco_min, v_margem, v_custo_base, v_previsao, v_imp, v_com,
      jsonb_build_object('impostos_pct', v_imp, 'comissao_pct', v_com, 'garantia_pct', v_gar,
        'custo_total', v_custo_total, 'tinha_vistoria', v_previsao IS NOT NULL)
        || CASE WHEN v_consig THEN jsonb_build_object('consignado', true) ELSE '{}'::jsonb END,
      NULLIF(btrim(p_dados->>'observacao'),''), v_autor)
  RETURNING id INTO v_hist;

  RETURN jsonb_build_object('ok', true, 'preco_venda', v_preco_venda, 'preco_minimo', v_preco_min, 'hist_id', v_hist)
    || CASE WHEN v_consig THEN jsonb_build_object('consignado', true) ELSE '{}'::jsonb END;
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_precificacao_salvar(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_precificacao_salvar(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 3) a conta do carro ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_conta_do_carro(p_veiculo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v record; v_pm jsonb; v_carrego jsonb; v_trib jsonb;
  v_aquisicao numeric; v_custos numeric; v_previsao numeric; v_custo_precif numeric;
  v_enc_soma numeric; v_enc_frac numeric; v_preco_min numeric; v_piso numeric;
  v_carrego_total numeric; v_custo_real numeric; v_anunciado numeric;
  v_lucro numeric; v_base numeric; v_dias int; v_roi numeric; v_sangria_dia numeric; v_vira date;
  v_enc_fonte text := 'config_pct';
  v_consig boolean;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, marca, modelo, placa, preco_venda, origem INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  v_consig := COALESCE(v.origem = 'consignacao', false);   -- #115: o valor de venda do consignado não é lucro da loja

  v_pm      := fn_veic_preco_minimo(p_veiculo_id);
  v_carrego := fn_veic_carrego(p_veiculo_id);

  v_aquisicao    := NULLIF(v_pm->'custo'->>'aquisicao','')::numeric;
  v_custos       := NULLIF(v_pm->'custo'->>'custos_lancados','')::numeric;
  v_previsao     := NULLIF(v_pm->'custo'->>'previsao_gastos','')::numeric;
  v_custo_precif := COALESCE(NULLIF(v_pm->'custo'->>'numerador','')::numeric, NULLIF(v_pm->'custo'->>'custo_total','')::numeric);
  v_enc_soma     := NULLIF(v_pm->'encargos_pct'->>'soma','')::numeric;
  v_preco_min    := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso         := NULLIF(v_pm->>'piso_sem_margem','')::numeric;
  v_carrego_total := NULLIF(v_carrego->>'total','')::numeric;
  v_sangria_dia  := NULLIF(v_carrego->>'sangria_dia','')::numeric;
  v_dias         := NULLIF(v_carrego->>'dias_parado','')::int;
  v_base         := NULLIF(v_carrego->>'capital_investido','')::numeric;
  v_anunciado    := v.preco_venda;

  -- R9b: encargo REAL do perfil aprovado (tributação sobre a diferença) substitui o % fixo quando disponível
  v_trib := fn_veic_tributos_diferenca(p_veiculo_id, v_anunciado);
  IF COALESCE((v_trib->>'aprovado')::boolean, false) AND COALESCE((v_trib->>'tem_rates')::boolean, false)
     AND (v_trib->>'encargos_pct_efetivo') IS NOT NULL THEN
    v_enc_soma := NULLIF(v_trib->>'encargos_pct_efetivo','')::numeric;
    v_enc_fonte := 'perfil_aprovado';
  END IF;

  v_enc_frac  := COALESCE(v_enc_soma,0)/100.0;
  v_custo_real := COALESCE(v_custo_precif,0) + COALESCE(v_carrego_total,0);
  v_lucro := CASE WHEN v_anunciado IS NULL OR v_consig THEN NULL ELSE round(v_anunciado * (1 - v_enc_frac) - v_custo_real, 2) END;
  v_roi := CASE WHEN v_lucro IS NOT NULL AND COALESCE(v_base,0) > 0 AND COALESCE(v_dias,0) > 0
                THEN round(v_lucro / v_base * 365.0 / v_dias * 100, 2) ELSE NULL END;
  v_vira := CASE WHEN v_lucro IS NOT NULL AND v_lucro > 0 AND COALESCE(v_sangria_dia,0) > 0
                 THEN current_date + floor(v_lucro / v_sangria_dia)::int ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'comprei', v_aquisicao, 'custos_lancados', v_custos, 'previsao_vistoria', v_previsao,
    'comissao_reais', NULLIF(v_pm->'custo'->>'comissao_reais','')::numeric,
    'sobrepreco_troca', jsonb_build_object('valor', NULL, 'status', 'nao_rastreado'),
    'carrego', v_carrego, 'custo_real_total', round(v_custo_real, 2),
    'piso_sem_margem', v_piso, 'preco_minimo', v_preco_min, 'anunciado', v_anunciado,
    'lucro_real_projetado', v_lucro, 'roi_anualizado_pct', v_roi, 'capital_investido', v_base,
    'dias_parado', v_dias, 'sangria_dia', v_sangria_dia, 'data_vira_prejuizo', v_vira,
    'comissao', v_pm->'comissao', 'encargos_pct', v_enc_soma, 'encargos_fonte', v_enc_fonte,
    'tributos_diferenca', v_trib
  ) || CASE WHEN v_consig THEN jsonb_build_object('consignado', true) ELSE '{}'::jsonb END;
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_conta_do_carro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_conta_do_carro(uuid) TO authenticated, service_role;

-- ── 4) a conta do pátio (lucro real do mês sem a venda de consignado) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_patio_conta(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  -- #115: venda de CONSIGNADO fica fora — o valor da venda não é lucro da loja (sem custo de aquisição).
  FOR r IN
    SELECT vd.veiculo_id, vd.valor_venda,
      COALESCE(vv.valor_aquisicao,0) AS aquisicao,
      (SELECT COALESCE(sum(c.valor),0) FROM veic_custo c WHERE c.veiculo_id=vv.id AND c.deleted_at IS NULL) AS custos,
      (SELECT iv.previsao_total FROM insp_vistoria iv WHERE iv.alvo_tabela='veic_veiculo' AND iv.alvo_id=vv.id AND iv.situacao='concluida' ORDER BY iv.concluida_em DESC LIMIT 1) AS previsao
    FROM veic_venda vd JOIN veic_veiculo vv ON vv.id = vd.veiculo_id
    WHERE vd.company_id = p_company_id AND vd.deleted_at IS NULL AND vd.situacao IN ('faturada','entregue')
      AND date_trunc('month', vd.data_venda) = date_trunc('month', current_date)
      AND vv.origem IS DISTINCT FROM 'consignacao'
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

REVOKE ALL ON FUNCTION public.fn_veic_patio_conta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_patio_conta(uuid) TO authenticated, service_role;
