-- ============================================================
-- Hub de Projetos · Sprint S3 (revisado) — Consolidação + Custo Fixo por m² editável por linha.
-- Substitui o S3 anterior: como o OMIE ainda não é confiável, o custo fixo por m² entra MANUAL
-- por linha agora (fonte = planilha) e vira rateio automático quando o financeiro estiver correto.
-- Resolução (RD-52, uma fonte por vez): manual → custo_fixo_m2 (digitado); rateio → mensal ÷ produção.
-- ============================================================

-- A — custo fixo por m² DIGITADO por linha (manual). mensal/realizado/origem já existiam (idempotente).
ALTER TABLE public.erp_precificacao_config
  ADD COLUMN IF NOT EXISTS custo_fixo_m2         numeric,
  ADD COLUMN IF NOT EXISTS custo_fixo_mensal     numeric,
  ADD COLUMN IF NOT EXISTS realizado_producao_m2 numeric,
  ADD COLUMN IF NOT EXISTS custo_fixo_origem     text DEFAULT 'manual'
    CHECK (custo_fixo_origem IN ('manual','rateio'));

-- B — Consolidação (revisada): custo fixo manual (digitado) OU rateio (mensal ÷ produção)
CREATE OR REPLACE FUNCTION public.fn_precificar_montagem(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_cfg RECORD; v_mat jsonb; v_mo jsonb;
  v_subtotal numeric; v_comissao numeric; v_cf numeric; v_prod numeric;
  v_total numeric; v_custo_total numeric; v_margem numeric;
BEGIN
  v_mat := fn_precificar_montagem_material(p_servico_id, p_company_id, p_business_line_id);
  v_mo  := fn_precificar_montagem_mao_obra(p_servico_id, p_company_id, p_business_line_id);
  IF (v_mat->>'ok')::bool IS NOT TRUE THEN RETURN v_mat; END IF;

  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id=p_company_id AND ativo
     AND (business_line_id=p_business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id=p_business_line_id) DESC NULLS LAST, vigencia_inicio DESC LIMIT 1;

  v_subtotal := COALESCE((v_mat->>'venda_material')::numeric,0) + COALESCE((v_mo->>'venda_mo')::numeric,0);
  v_comissao := v_subtotal * COALESCE(v_cfg.comissao_pct,0)/100.0;

  -- CUSTO FIXO por m²: manual (digitado) OU rateio (mensal ÷ produção)
  IF COALESCE(v_cfg.custo_fixo_origem,'manual')='rateio' THEN
     v_prod := CASE WHEN v_cfg.base_custo_fixo='realizado'
                    THEN NULLIF(v_cfg.realizado_producao_m2,0) ELSE NULLIF(v_cfg.meta_producao_m2,0) END;
     v_cf := CASE WHEN v_prod IS NULL THEN 0 ELSE COALESCE(v_cfg.custo_fixo_mensal,0)/v_prod END;
  ELSE
     v_cf := COALESCE(v_cfg.custo_fixo_m2,0);   -- manual (digitado por linha)
  END IF;

  v_total := v_subtotal + v_comissao + v_cf;
  v_custo_total := COALESCE((v_mat->>'custo_capado')::numeric,0) + COALESCE((v_mat->>'impostos_saida')::numeric,0)
                 + COALESCE((v_mo->>'mo_com_imposto')::numeric,0) + v_comissao + v_cf;
  v_margem := v_total - v_custo_total;

  RETURN jsonb_build_object('ok', true, 'material', v_mat, 'mao_obra', v_mo,
    'venda_material', round(COALESCE((v_mat->>'venda_material')::numeric,0),2),
    'venda_mo', round(COALESCE((v_mo->>'venda_mo')::numeric,0),2),
    'subtotal_m2', round(v_subtotal,2), 'comissao', round(v_comissao,2),
    'custo_fixo_m2', round(v_cf,2), 'custo_fixo_origem', COALESCE(v_cfg.custo_fixo_origem,'manual'),
    'total_m2', round(v_total,2), 'margem_rs', round(v_margem,2),
    'margem_pct', CASE WHEN v_total>0 THEN round(v_margem/v_total*100,2) ELSE 0 END);
END $f$;

-- C — salvar: + custo_fixo_m2 (guardado por `?` pra cliente antigo não zerar)
CREATE OR REPLACE FUNCTION public.fn_precificacao_config_salvar(
  p_company_id uuid, p_business_line_id uuid, p_premissas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_id uuid;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE public.erp_precificacao_config SET
    custo_folha_hora   = (p_premissas->>'custo_folha_hora')::numeric,
    tempo_m2_min       = (p_premissas->>'tempo_m2_min')::numeric,
    imposto_mo_pct     = (p_premissas->>'imposto_mo_pct')::numeric,
    margem_mo_pct      = (p_premissas->>'margem_mo_pct')::numeric,
    margem_material_pct= (p_premissas->>'margem_material_pct')::numeric,
    icms_pct           = (p_premissas->>'icms_pct')::numeric,
    pis_cofins_pct     = (p_premissas->>'pis_cofins_pct')::numeric,
    creditos_pct       = (p_premissas->>'creditos_pct')::numeric,
    comissao_pct       = (p_premissas->>'comissao_pct')::numeric,
    meta_producao_m2   = (p_premissas->>'meta_producao_m2')::numeric,
    base_custo_fixo    = COALESCE(p_premissas->>'base_custo_fixo','meta'),
    custo_fixo_m2         = CASE WHEN p_premissas ? 'custo_fixo_m2'         THEN (p_premissas->>'custo_fixo_m2')::numeric         ELSE custo_fixo_m2 END,
    custo_fixo_mensal     = CASE WHEN p_premissas ? 'custo_fixo_mensal'     THEN (p_premissas->>'custo_fixo_mensal')::numeric     ELSE custo_fixo_mensal END,
    realizado_producao_m2 = CASE WHEN p_premissas ? 'realizado_producao_m2' THEN (p_premissas->>'realizado_producao_m2')::numeric ELSE realizado_producao_m2 END,
    custo_fixo_origem     = CASE WHEN p_premissas ? 'custo_fixo_origem'     THEN COALESCE(p_premissas->>'custo_fixo_origem','manual') ELSE custo_fixo_origem END,
    updated_at = now()
  WHERE company_id = p_company_id AND ativo
    AND (business_line_id IS NOT DISTINCT FROM p_business_line_id)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.erp_precificacao_config
      (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
       margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, base_custo_fixo,
       custo_fixo_m2, custo_fixo_mensal, realizado_producao_m2, custo_fixo_origem)
    VALUES (p_company_id, p_business_line_id,
      (p_premissas->>'custo_folha_hora')::numeric, (p_premissas->>'tempo_m2_min')::numeric,
      (p_premissas->>'imposto_mo_pct')::numeric, (p_premissas->>'margem_mo_pct')::numeric,
      (p_premissas->>'margem_material_pct')::numeric, (p_premissas->>'icms_pct')::numeric,
      (p_premissas->>'pis_cofins_pct')::numeric, (p_premissas->>'creditos_pct')::numeric,
      (p_premissas->>'comissao_pct')::numeric, (p_premissas->>'meta_producao_m2')::numeric,
      COALESCE(p_premissas->>'base_custo_fixo','meta'),
      (p_premissas->>'custo_fixo_m2')::numeric, (p_premissas->>'custo_fixo_mensal')::numeric,
      (p_premissas->>'realizado_producao_m2')::numeric, COALESCE(p_premissas->>'custo_fixo_origem','manual'))
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $f$;
