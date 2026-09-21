-- Revenda · item 3 — a comissão entra no preço mínimo (fonte única, RD-65 / RD-51).
--
-- Decisão do CEO: a comissão que PRECIFICA o estoque é a regra marcada `usar_na_precificacao`
-- (no máximo uma por empresa, garantido por índice parcial) ou, na falta de marcação, a MAIOR
-- comissão ativa (em R$, calculável na hora). Como ela entra no preço mínimo depende da base:
--   • base FIPE / fixo  → vira R$ e entra no NUMERADOR:  preço = (custo + comissão_R$) / (1 − enc% − margem%)
--   • base preço        → segue como % no DENOMINADOR (igual a um encargo)
--   • base lucro        → % do lucro; no mínimo o lucro-alvo = margem% do preço, logo entra no
--                         denominador como % equivalente = percentual × margem% / 100
--   • sem regra         → mantém o comissao_venda_pct da veic_config (compatível com quem não usa regras)
--   • regra FIPE sem valor_fipe (ou % nulo) → 'nao_configurado' (RD-51): preço mínimo NULL, nunca R$0.
--
-- Um helper único (fn_veic_comissao_precificacao) toma a decisão; preço mínimo, conta do carro,
-- precificação (ficha) e o simulador de teto leem dele — assim o número é IGUAL nas três telas, e o
-- acerto (fn_veic_venda_acerto) herda a comissão via fn_veic_conta_do_carro (custo real e lucro real).
-- Aditivo (RD-55, CREATE OR REPLACE). Sem regras cadastradas, o resultado é idêntico ao de hoje.

-- ── Helper: qual comissão precifica este veículo, e como (R$ no numerador × % no denominador).
CREATE OR REPLACE FUNCTION public.fn_veic_comissao_precificacao(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_fipe numeric; v_margem numeric; v_com_cfg numeric; r record;
  v_reais numeric := 0; v_pct numeric := 0; v_nao boolean := false; v_status text := 'ok';
  v_fonte text; v_base text; v_rotulo text; v_perc numeric; v_fixo numeric; v_flag boolean := false;
BEGIN
  SELECT vv.company_id, vv.valor_fipe, COALESCE(vv.margem_alvo_pct, cfg.margem_alvo_pct), cfg.comissao_venda_pct
    INTO v_comp, v_fipe, v_margem, v_com_cfg
    FROM veic_veiculo vv LEFT JOIN veic_config cfg ON cfg.company_id = vv.company_id
   WHERE vv.id = p_veiculo_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('status','sem_veiculo'); END IF;

  SELECT base, percentual, valor_fixo, rotulo, usar_na_precificacao INTO r
    FROM veic_comissao_regra
   WHERE company_id = v_comp AND ativo
   ORDER BY (usar_na_precificacao IS TRUE) DESC,                    -- a marcada vence
            (CASE base WHEN 'fixo' THEN COALESCE(valor_fixo,0)      -- senão a maior em R$ calculável
                       WHEN 'fipe' THEN COALESCE(v_fipe,0)*COALESCE(percentual,0)/100.0
                       ELSE 0 END) DESC,
            COALESCE(percentual,0) DESC, created_at ASC
   LIMIT 1;

  IF FOUND THEN
    v_base := r.base; v_rotulo := r.rotulo; v_flag := COALESCE(r.usar_na_precificacao,false);
    v_perc := r.percentual; v_fixo := r.valor_fixo; v_fonte := 'regra:'||r.base;
    IF r.base = 'fixo' THEN
      IF r.valor_fixo IS NULL THEN v_nao := true; ELSE v_reais := r.valor_fixo; END IF;
    ELSIF r.base = 'fipe' THEN
      IF v_fipe IS NULL OR r.percentual IS NULL THEN v_nao := true; ELSE v_reais := round(v_fipe * r.percentual/100.0, 2); END IF;
    ELSIF r.base = 'preco' THEN
      IF r.percentual IS NULL THEN v_nao := true; ELSE v_pct := r.percentual; END IF;
    ELSIF r.base = 'lucro' THEN
      IF r.percentual IS NULL THEN v_nao := true; ELSE v_pct := round(r.percentual * COALESCE(v_margem,0)/100.0, 4); END IF;
    END IF;
  ELSE
    v_fonte := 'config'; v_base := 'config'; v_pct := COALESCE(v_com_cfg,0);
  END IF;
  IF v_nao THEN v_status := 'nao_configurado'; END IF;

  RETURN jsonb_build_object('fonte', v_fonte, 'base', v_base, 'rotulo', v_rotulo,
    'percentual', v_perc, 'valor_fixo', v_fixo, 'na_precificacao', v_flag, 'fipe', v_fipe,
    'reais', CASE WHEN v_nao THEN NULL ELSE v_reais END,
    'pct',   CASE WHEN v_nao THEN NULL ELSE v_pct END,
    'nao_config', v_nao, 'status', v_status);
END $function$;

-- ── Preço mínimo: numerador ganha a comissão R$; denominador ganha a comissão %.
CREATE OR REPLACE FUNCTION public.fn_veic_preco_minimo(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_previsao numeric; v_vist_id uuid; v_aj jsonb;
  v_custo_total numeric; v_numerador numeric; v_imp numeric; v_com_cfg numeric; v_gar numeric; v_margem numeric;
  v_soma_enc_frac numeric; v_margem_frac numeric; v_denom_min numeric; v_denom_piso numeric;
  v_preco_min numeric; v_piso numeric;
  v_com jsonb; v_com_reais numeric; v_com_pct numeric; v_com_nao boolean;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, margem_alvo_pct
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_inexistente'); END IF;

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

  v_preco_min := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_min  > 0.0001 AND NOT v_com_nao
                      THEN round(v_numerador / v_denom_min, 2)  ELSE NULL END;
  v_piso      := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_piso > 0.0001 AND NOT v_com_nao
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
      'sem_custo_aquisicao', COALESCE(v.valor_aquisicao,0) <= 0,
      'sem_vistoria', v_vist_id IS NULL,
      'piso_incompleto', (v_imp IS NULL OR v_gar IS NULL OR v_com_nao),
      'sem_margem_config', v_margem IS NULL,
      'comissao_nao_configurada', v_com_nao,
      'encargos_margem_inviaveis', (v_denom_min <= 0.0001)));
END $function$;

-- ── Conta do carro: o custo real usa o NUMERADOR (custo + comissão R$); o % (comissão preço/lucro) já
--    vem em encargos_pct.soma. Assim o lucro projetado e o acerto descontam a comissão certa.
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
  -- numerador = aquisição + custos + previsão + comissão R$ (fallback ao custo_total dos registros antigos)
  v_custo_precif := COALESCE(NULLIF(v_pm->'custo'->>'numerador','')::numeric, NULLIF(v_pm->'custo'->>'custo_total','')::numeric);
  v_enc_soma     := NULLIF(v_pm->'encargos_pct'->>'soma','')::numeric;   -- % (impostos+comissão%+garantia)
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
    'comissao_reais', NULLIF(v_pm->'custo'->>'comissao_reais','')::numeric,
    'sobrepreco_troca', jsonb_build_object('valor', NULL, 'status', 'nao_rastreado'),
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
    'comissao', v_pm->'comissao',
    'encargos_pct', v_enc_soma
  );
END $function$;

-- ── Precificação (ficha): mostra a comissão EFETIVA que precifica (regra ou config), não só o % da config.
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_obter(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_pm jsonb; v_preco_min numeric; v_piso numeric; v_aj jsonb;
  v_com_ef numeric; v_com_val numeric; v_com_status text; v_com_nao boolean; v_com_obj jsonb;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, preco_venda, preco_minimo,
         margem_alvo_pct, precificado_em INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  v_aj := fn_veic_previsao_vistoria_ajustada(p_veiculo_id);
  v_vist_id := NULLIF(v_aj->>'vistoria_id','')::uuid;
  v_previsao := NULLIF(v_aj->>'ajustada','')::numeric;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);

  v_pm := public.fn_veic_preco_minimo(p_veiculo_id);
  v_preco_min := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso      := NULLIF(v_pm->>'piso_sem_margem','')::numeric;
  -- comissão efetiva (regra ou config), da fonte única
  v_com_obj    := v_pm->'comissao';
  v_com_ef     := NULLIF(v_pm->'encargos_pct'->>'comissao','')::numeric;                  -- % efetivo (0 p/ fipe/fixo)
  v_com_val    := CASE WHEN v_preco_min IS NULL THEN NULL ELSE NULLIF(v_pm->'detalhe'->>'comissao_valor','')::numeric END;
  v_com_status := v_com_obj->>'status';
  v_com_nao    := COALESCE((v_pm->'flags'->>'comissao_nao_configurada')::boolean, false);

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'custo_base', v_custo_base, 'custo_total', v_custo_total,
      'comissao_reais', NULLIF(v_pm->'custo'->>'comissao_reais','')::numeric),
    'encargos', jsonb_build_object(
      'impostos', jsonb_build_object('pct', v_imp, 'valor', CASE WHEN v_imp IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'impostos_valor')::numeric END, 'configurado', v_imp IS NOT NULL),
      'comissao', jsonb_build_object('pct', v_com_ef, 'valor', v_com_val, 'configurado', (v_com_status = 'ok' AND NOT v_com_nao),
        'fonte', v_com_obj->>'fonte', 'base', v_com_obj->>'base', 'rotulo', v_com_obj->>'rotulo',
        'na_precificacao', (v_com_obj->>'na_precificacao')::boolean, 'status', v_com_status),
      'garantia', jsonb_build_object('pct', v_gar, 'valor', CASE WHEN v_gar IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'garantia_valor')::numeric END, 'configurado', v_gar IS NOT NULL)),
    'preco_minimo', v_preco_min,
    'piso_sem_margem', v_piso,
    'preco_sugerido', v_preco_min,
    'margem_alvo_pct', v_margem,
    'preco_venda', v.preco_venda,
    'precificado_em', v.precificado_em,
    'margem_projetada', CASE WHEN v.preco_venda IS NOT NULL AND v_preco_min IS NOT NULL THEN v.preco_venda - v_preco_min ELSE NULL END,
    'incerteza', jsonb_strip_nulls(jsonb_build_object(
      'sem_previsao_de_gastos', CASE WHEN v_vist_id IS NULL THEN true ELSE NULL END,
      'sem_custo_lancado', CASE WHEN v_custos = 0 THEN true ELSE NULL END,
      'impostos_nao_config', CASE WHEN v_imp IS NULL THEN true ELSE NULL END,
      'comissao_nao_config', CASE WHEN v_com_nao THEN true ELSE NULL END,
      'garantia_nao_config', CASE WHEN v_gar IS NULL THEN true ELSE NULL END)),
    'piso_incompleto', (v_imp IS NULL OR v_gar IS NULL OR v_com_nao),
    'historico', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'preco_venda', h.preco_venda, 'preco_minimo', h.preco_minimo, 'margem_alvo_pct', h.margem_alvo_pct,
        'custo_base', h.custo_base, 'previsao_gastos', h.previsao_gastos, 'premissas', h.premissas,
        'observacao', h.observacao, 'criado_em', h.criado_em) ORDER BY h.criado_em DESC), '[]'::jsonb)
      FROM veic_precificacao_hist h WHERE h.veiculo_id = p_veiculo_id));
END $function$;

-- ── Simulador (teto de compra / what-if): mesma comissão da precificação, para não divergir de tela p/ tela.
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_simular(p_veiculo_id uuid, p_preco_venda numeric, p_margem_pct numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_gar numeric;
  v_soma_pct numeric; v_teto numeric; v_preco_min numeric; v_soma_enc numeric;
  v_com jsonb; v_com_reais numeric; v_com_pct numeric; v_com_nao boolean;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT company_id, valor_aquisicao INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  SELECT id, previsao_total INTO v_vist_id, v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida' ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);
  SELECT impostos_venda_pct, provisao_garantia_pct INTO v_imp, v_gar FROM veic_config WHERE company_id = v.company_id;

  v_com       := fn_veic_comissao_precificacao(p_veiculo_id);
  v_com_nao   := COALESCE((v_com->>'nao_config')::boolean, false);
  v_com_reais := COALESCE((v_com->>'reais')::numeric, 0);
  v_com_pct   := COALESCE((v_com->>'pct')::numeric, 0);

  v_soma_pct := COALESCE(p_margem_pct,0) + COALESCE(v_imp,0) + COALESCE(v_gar,0) + v_com_pct;
  v_soma_enc := v_custo_total * (COALESCE(v_imp,0) + COALESCE(v_gar,0) + v_com_pct)/100 + v_com_reais;
  v_preco_min := CASE WHEN v_com_nao THEN NULL ELSE v_custo_total + v_soma_enc END;
  -- teto de compra: quanto pode pagar na aquisição para vender a p_preco_venda com esses percentuais + comissão R$
  v_teto := CASE WHEN v_com_nao THEN NULL
                 ELSE ((COALESCE(p_preco_venda,0) - v_com_reais) / (1 + v_soma_pct/100)) - COALESCE(v_previsao,0) - v_custos END;

  RETURN jsonb_build_object('ok', true,
    'preco_venda', p_preco_venda, 'margem_pct', p_margem_pct,
    'custo_total', v_custo_total, 'previsao_gastos', v_previsao, 'custos_lancados', v_custos,
    'comissao', v_com,
    'preco_minimo', v_preco_min,
    'margem_projetada', CASE WHEN v_preco_min IS NULL THEN NULL ELSE COALESCE(p_preco_venda,0) - v_preco_min END,
    'teto_de_compra', v_teto,
    'abaixo_do_piso', (v_preco_min IS NOT NULL AND p_preco_venda IS NOT NULL AND p_preco_venda < v_preco_min),
    'prejuizo_no_piso', CASE WHEN v_preco_min IS NOT NULL AND p_preco_venda IS NOT NULL AND p_preco_venda < v_preco_min THEN v_preco_min - p_preco_venda ELSE 0 END,
    'comissao_nao_configurada', v_com_nao,
    'sem_previsao_de_gastos', v_vist_id IS NULL);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_veic_comissao_precificacao(uuid) TO authenticated, service_role;
