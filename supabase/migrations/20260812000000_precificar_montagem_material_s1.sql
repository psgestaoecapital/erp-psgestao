-- ============================================================
-- Hub de Projetos · Sprint S1 — Motor de Material tax-aware (Pilar 1 · RD-53).
-- O primeiro R$ calculado: BOM (insumos) × custo REAL do estoque (m16_insumos.current_cost)
-- × (1+perda) → custo do material; desconta créditos do regime (capado); aplica ICMS+PIS/COFINS
-- de saída e a margem do material → venda por m². Breakdown transparente (itens + etapas).
-- Depende de S0 (erp_precificacao_config). Só tipo='insumo' (mão de obra = S2).
--
-- MÉTODO DE IMPOSTO: 'por_fora' (imposto sobre o capado, aditivo, fácil de auditar). Se a 1ª
-- comparação com a planilha divergir, a alternativa é 'por_dentro' (imposto embutido no preço):
--   venda = (capado × (1+margem%)) / (1 − (icms%+pis_cofins%)/100); impostos = venda × (…)/100
-- — troca de uma linha, decidida pela planilha.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_precificar_montagem_material(
  p_servico_id uuid,
  p_company_id uuid,
  p_business_line_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
  v_custo_material numeric := 0;
  v_custo_capado numeric;
  v_impostos numeric;
  v_margem numeric;
  v_venda numeric;
  v_itens jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- resolução da config: (empresa, linha) -> fallback (empresa, NULL); vigência mais recente
  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = p_business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = p_business_line_id) DESC NULLS LAST, vigencia_inicio DESC
   LIMIT 1;
  IF v_cfg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_config_precificacao');
  END IF;

  -- 1) CUSTO DO MATERIAL: BOM × custo REAL do estoque × (1+perda)
  SELECT
    COALESCE(SUM(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(i.current_cost,0)), 0),
    jsonb_agg(jsonb_build_object(
      'insumo', i.name, 'qtd_m2', b.quantidade, 'perda_pct', b.perda_pct,
      'custo_unit', i.current_cost,
      'custo_item', round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(i.current_cost,0), 4)
    ) ORDER BY b.ordem)
  INTO v_custo_material, v_itens
  FROM projetos_servicos_bom b
  JOIN m16_insumos i ON i.id = b.insumo_id
  WHERE b.servico_id = p_servico_id AND b.tipo = 'insumo';

  -- 2) CAPADO (créditos do regime) · 3) IMPOSTOS DE SAÍDA (por_fora) · 4) MARGEM · 5) VENDA
  v_custo_capado := v_custo_material * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0);
  v_impostos := v_custo_capado * (COALESCE(v_cfg.icms_pct,0) + COALESCE(v_cfg.pis_cofins_pct,0))/100.0;
  v_margem := (v_custo_capado + v_impostos) * COALESCE(v_cfg.margem_material_pct,0)/100.0;
  v_venda := v_custo_capado + v_impostos + v_margem;

  RETURN jsonb_build_object(
    'ok', true,
    'servico_id', p_servico_id,
    'config', jsonb_build_object('creditos_pct', v_cfg.creditos_pct, 'icms_pct', v_cfg.icms_pct,
       'pis_cofins_pct', v_cfg.pis_cofins_pct, 'margem_material_pct', v_cfg.margem_material_pct,
       'linha', v_cfg.business_line_id),
    'custo_material', round(v_custo_material, 2),
    'custo_capado',   round(v_custo_capado, 2),
    'impostos_saida', round(v_impostos, 2),
    'margem_material',round(v_margem, 2),
    'venda_material', round(v_venda, 2),
    'metodo_imposto', 'por_fora',
    'itens', v_itens
  );
END $function$;
