-- Revenda R0.1 · Preço mínimo com FONTE ÚNICA (RD-65)
--
-- BUG de regra: o mesmo veículo mostrava preços mínimos diferentes:
--   • ficha: custo × (1 + margem%)            → só margem, ignora encargos, margem POR FORA
--   • precificação: custo + encargos_sobre_CUSTO → só encargos, ignora margem
-- Nenhuma das duas era o preço que cobre custo + encargos-da-venda (que incidem SOBRE O PREÇO) + margem.
--
-- Correção: uma única função fn_veic_preco_minimo(veiculo) que resolve o preço POR DENTRO:
--     preço = custo_total / (1 − encargos% − margem%)
-- (encargos e margem são % do preço de venda, não do custo). Devolve o detalhamento e o "piso sem margem"
-- (custo + encargos, sem margem: custo_total / (1 − encargos%)). Ficha, pátio e precificação LEEM dela.

CREATE OR REPLACE FUNCTION public.fn_veic_preco_minimo(p_veiculo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_previsao numeric; v_vist_id uuid;
  v_custo_total numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_soma_enc_frac numeric; v_margem_frac numeric; v_denom_min numeric; v_denom_piso numeric;
  v_preco_min numeric; v_piso numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, margem_alvo_pct
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_inexistente'); END IF;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c
    WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  SELECT id, previsao_total INTO v_vist_id, v_previsao FROM insp_vistoria
    WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida'
    ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := COALESCE(v.valor_aquisicao,0) + v_custos + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);  -- margem do veículo tem precedência

  -- % → fração. NULL conta como 0 no cálculo (mas fica sinalizado como não configurado).
  v_soma_enc_frac := (COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0)) / 100.0;
  v_margem_frac   := COALESCE(v_margem,0) / 100.0;
  v_denom_min  := 1 - v_soma_enc_frac - v_margem_frac;   -- preço por dentro, com margem
  v_denom_piso := 1 - v_soma_enc_frac;                   -- piso por dentro, sem margem

  -- Guard: sem custo → não calcula; denominador ≤ 0 (encargos+margem ≥ 100%) → impossível resolver.
  v_preco_min := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_min  > 0.0001
                      THEN round(v_custo_total / v_denom_min, 2)  ELSE NULL END;
  v_piso      := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_piso > 0.0001
                      THEN round(v_custo_total / v_denom_piso, 2) ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'custo_total', v_custo_total),
    'encargos_pct', jsonb_build_object('impostos', v_imp, 'comissao', v_com, 'garantia', v_gar,
      'soma', COALESCE(v_imp,0)+COALESCE(v_com,0)+COALESCE(v_gar,0)),
    'margem_pct', v_margem,
    'preco_minimo', v_preco_min,       -- cobre custo + encargos (sobre o preço) + margem alvo
    'piso_sem_margem', v_piso,         -- cobre custo + encargos (sobre o preço), sem margem
    -- detalhamento no preço mínimo (valores que compõem o preço, todos % do PREÇO)
    'detalhe', CASE WHEN v_preco_min IS NULL THEN NULL ELSE jsonb_build_object(
      'impostos_valor', round(v_preco_min * COALESCE(v_imp,0)/100, 2),
      'comissao_valor', round(v_preco_min * COALESCE(v_com,0)/100, 2),
      'garantia_valor', round(v_preco_min * COALESCE(v_gar,0)/100, 2),
      'margem_valor',   round(v_preco_min * COALESCE(v_margem,0)/100, 2)) END,
    'flags', jsonb_build_object(
      'sem_custo_aquisicao', COALESCE(v.valor_aquisicao,0) <= 0,
      'sem_vistoria', v_vist_id IS NULL,
      'piso_incompleto', (v_imp IS NULL OR v_com IS NULL OR v_gar IS NULL),
      'sem_margem_config', v_margem IS NULL,
      'encargos_margem_inviaveis', (v_denom_min <= 0.0001)));
END $function$;

COMMENT ON FUNCTION public.fn_veic_preco_minimo(uuid) IS
  'RD-65: fonte única do preço mínimo do veículo. custo_total + encargos (sobre o preço) + margem, resolvido por dentro. Ficha, pátio e precificação leem daqui — nenhum cálculo na tela.';
REVOKE ALL ON FUNCTION public.fn_veic_preco_minimo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_preco_minimo(uuid) TO authenticated, service_role;

-- ── fn_veic_precificacao_obter passa a LER a fonte única ──────────────────────────────────────────────
-- Mantém as chaves que a tela usa (custo, encargos com 'configurado', histórico, incerteza, preco_venda),
-- mas o preco_minimo e o novo piso_sem_margem vêm de fn_veic_preco_minimo (mesma conta em toda tela).
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_obter(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_pm jsonb; v_preco_min numeric; v_piso numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, preco_venda, preco_minimo,
         margem_alvo_pct, precificado_em INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  SELECT id, previsao_total INTO v_vist_id, v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida'
   ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);

  -- FONTE ÚNICA
  v_pm := public.fn_veic_preco_minimo(p_veiculo_id);
  v_preco_min := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso      := NULLIF(v_pm->>'piso_sem_margem','')::numeric;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'custo_base', v_custo_base, 'custo_total', v_custo_total),
    'encargos', jsonb_build_object(
      'impostos', jsonb_build_object('pct', v_imp, 'valor', CASE WHEN v_imp IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'impostos_valor')::numeric END, 'configurado', v_imp IS NOT NULL),
      'comissao', jsonb_build_object('pct', v_com, 'valor', CASE WHEN v_com IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'comissao_valor')::numeric END, 'configurado', v_com IS NOT NULL),
      'garantia', jsonb_build_object('pct', v_gar, 'valor', CASE WHEN v_gar IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'garantia_valor')::numeric END, 'configurado', v_gar IS NOT NULL)),
    'preco_minimo', v_preco_min,                    -- com margem, por dentro (fonte única)
    'piso_sem_margem', v_piso,                       -- sem margem, por dentro (fonte única)
    'preco_sugerido', v_preco_min,                   -- sugestão = preço mínimo (cobre tudo + margem)
    'margem_alvo_pct', v_margem,
    'preco_venda', v.preco_venda,
    'precificado_em', v.precificado_em,
    'margem_projetada', CASE WHEN v.preco_venda IS NOT NULL AND v_preco_min IS NOT NULL THEN v.preco_venda - v_preco_min ELSE NULL END,
    'incerteza', jsonb_strip_nulls(jsonb_build_object(
      'sem_previsao_de_gastos', CASE WHEN v_vist_id IS NULL THEN true ELSE NULL END,
      'sem_custo_lancado', CASE WHEN v_custos = 0 THEN true ELSE NULL END,
      'impostos_nao_config', CASE WHEN v_imp IS NULL THEN true ELSE NULL END,
      'comissao_nao_config', CASE WHEN v_com IS NULL THEN true ELSE NULL END,
      'garantia_nao_config', CASE WHEN v_gar IS NULL THEN true ELSE NULL END)),
    'piso_incompleto', (v_imp IS NULL OR v_com IS NULL OR v_gar IS NULL),
    'historico', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'preco_venda', h.preco_venda, 'preco_minimo', h.preco_minimo, 'margem_alvo_pct', h.margem_alvo_pct,
        'custo_base', h.custo_base, 'previsao_gastos', h.previsao_gastos, 'premissas', h.premissas,
        'observacao', h.observacao, 'criado_em', h.criado_em) ORDER BY h.criado_em DESC), '[]'::jsonb)
      FROM veic_precificacao_hist h WHERE h.veiculo_id = p_veiculo_id));
END $function$;
