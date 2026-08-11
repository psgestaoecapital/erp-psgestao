-- ============================================================
-- FIX — Custo Fixo por m² editável DIRETO por linha (retaguarda).
-- O S3 revisado (#961) já pôs custo_fixo_m2 (R$/m² digitado direto) e a tela editável. Este patch
-- refina só o bloco de custo fixo do motor: no modo MANUAL, usa o custo_fixo_m2 digitado; se estiver
-- nulo, cai em custo_fixo_mensal ÷ produção como RETAGUARDA (antes caía em 0). Modo rateio inalterado.
-- custo_fixo_m2 (coluna) e o salvar já existem do #961 — aqui só o CREATE OR REPLACE do motor.
-- ============================================================
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

  -- CUSTO FIXO por m²: manual (digitado direto, retaguarda mensal÷produção) OU rateio (mensal÷produção)
  IF COALESCE(v_cfg.custo_fixo_origem,'manual')='rateio' THEN
     v_prod := CASE WHEN v_cfg.base_custo_fixo='realizado'
                    THEN NULLIF(v_cfg.realizado_producao_m2,0) ELSE NULLIF(v_cfg.meta_producao_m2,0) END;
     v_cf := CASE WHEN v_prod IS NULL THEN 0 ELSE COALESCE(v_cfg.custo_fixo_mensal,0)/v_prod END;
  ELSE
     IF v_cfg.custo_fixo_m2 IS NOT NULL THEN
        v_cf := v_cfg.custo_fixo_m2;                      -- R$/m² digitado direto por linha
     ELSE
        v_prod := NULLIF(v_cfg.meta_producao_m2,0);       -- retaguarda: mensal ÷ produção
        v_cf := CASE WHEN v_prod IS NULL THEN 0 ELSE COALESCE(v_cfg.custo_fixo_mensal,0)/v_prod END;
     END IF;
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
