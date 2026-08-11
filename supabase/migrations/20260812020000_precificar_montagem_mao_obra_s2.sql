-- ============================================================
-- Hub de Projetos · Sprint S2 — Motor de Mão de Obra (Pilar 1 · RD-53).
-- Camada de MO por produtividade: folha/hora × tempo por m² → + imposto MO → + margem MO
-- = venda da MO por m². + helper combinado (material + MO) que o Simulador (S4) vai consumir.
-- Depende de S0 (config) e S1 (fn_precificar_montagem_material). Só premissas (tudo editável na tela).
--
-- Tempo de MO: método base usa tempo_m2_min da premissa (uniforme por linha, como a planilha).
-- Alternativa por-montagem = somar as linhas tipo='mao_obra' do BOM — switchable na conferência.
-- Imposto MO: por_fora (consistente com o S1). Comissão + custo fixo + consolidação final = S3.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_precificar_montagem_mao_obra(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_cfg RECORD;
  v_horas numeric;
  v_custo_mo numeric; v_imposto numeric; v_mo_ci numeric; v_margem numeric; v_venda numeric;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- config: (empresa, linha) -> fallback (empresa, NULL)
  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = p_business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = p_business_line_id) DESC NULLS LAST, vigencia_inicio DESC
   LIMIT 1;
  IF v_cfg.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_config_precificacao'); END IF;

  -- HORAS de MO por m² = tempo_m2_min / 60 (método base da planilha)
  v_horas := COALESCE(v_cfg.tempo_m2_min,0) / 60.0;

  v_custo_mo := v_horas * COALESCE(v_cfg.custo_folha_hora,0);
  v_imposto  := v_custo_mo * COALESCE(v_cfg.imposto_mo_pct,0)/100.0;   -- por_fora
  v_mo_ci    := v_custo_mo + v_imposto;
  v_margem   := v_mo_ci * COALESCE(v_cfg.margem_mo_pct,0)/100.0;
  v_venda    := v_mo_ci + v_margem;

  RETURN jsonb_build_object(
    'ok', true,
    'horas_m2', round(v_horas, 4),
    'custo_mo', round(v_custo_mo, 2),
    'imposto_mo', round(v_imposto, 2),
    'mo_com_imposto', round(v_mo_ci, 2),
    'margem_mo', round(v_margem, 2),
    'venda_mo', round(v_venda, 2),
    'metodo_imposto', 'por_fora'
  );
END $f$;

-- Helper combinado (material + MO) — início da consolidação (comissão/custo fixo = S3)
CREATE OR REPLACE FUNCTION public.fn_precificar_montagem(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_mat jsonb; v_mo jsonb; v_subtotal numeric;
BEGIN
  v_mat := fn_precificar_montagem_material(p_servico_id, p_company_id, p_business_line_id);
  v_mo  := fn_precificar_montagem_mao_obra(p_servico_id, p_company_id, p_business_line_id);
  IF (v_mat->>'ok')::bool IS NOT TRUE THEN RETURN v_mat; END IF;

  v_subtotal := COALESCE((v_mat->>'venda_material')::numeric,0) + COALESCE((v_mo->>'venda_mo')::numeric,0);

  RETURN jsonb_build_object(
    'ok', true,
    'material', v_mat,
    'mao_obra', v_mo,
    'subtotal_m2', round(v_subtotal, 2),
    'pendente', jsonb_build_array('comissao', 'custo_fixo', 'consolidacao_final')
  );
END $f$;
