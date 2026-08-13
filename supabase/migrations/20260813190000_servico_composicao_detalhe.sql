-- RD-41 · Composição de Preço Unitário (CPU) — detalhe por item, padrão de mercado (SINAPI/TCPO/ORSE).
-- Genérica: qualquer construtora, qualquer ofício. Nível 1 (CPU padrão) + Nível 2 (decomposição tax-aware).
--
-- RD-26 (reuso): coeficiente = quantidade × (1 + perda_pct) sobre projetos_servicos_bom; custo unitário SEMPRE
-- do estoque (m16_insumos.current_cost) / da mão de obra (projetos_mao_obra.custo_hora) — RD-52, uma fonte.
-- As camadas tributárias usam as MESMAS taxas/precedência do motor fn_precificar_montagem_material/_mao_obra
-- (erp_precificacao_config por business_line), aplicadas por item (decomposição linear → soma bate o motor).
-- Tax-aware por REGIME: as alíquotas vêm da config (que o regime governa), nunca hardcoded; o regime da
-- empresa vai no cabeçalho só como contexto. O cabeçalho de venda vem do próprio motor (validador Tryo bate).
--
-- Sem config de precificação: retorna o Nível 1 (coeficiente + custo do estoque + custo no serviço) mesmo
-- assim; os campos tributários e o preço de venda ficam null com a flag sem_config (RD-51 · 3 estados honestos).
CREATE OR REPLACE FUNCTION public.fn_servico_composicao_detalhe(p_company_id uuid, p_servico_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_srv RECORD; v_cfg RECORD; v_regime text; v_has_cfg boolean;
  v_itens jsonb := '[]'::jsonb;
  v_cm numeric := 0; v_cmo numeric := 0; v_ceq numeric := 0; v_ct numeric := 0;
  v_eng jsonb; v_venda numeric; v_bdi numeric;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT s.* INTO v_srv FROM projetos_servicos s
   WHERE s.id = p_servico_id AND (s.company_id = p_company_id OR s.is_publico);
  IF v_srv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'servico_nao_encontrado'); END IF;

  SELECT regime_tributario INTO v_regime FROM companies WHERE id = p_company_id;

  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = v_srv.business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = v_srv.business_line_id) DESC NULLS LAST, vigencia_inicio DESC LIMIT 1;
  v_has_cfg := v_cfg.id IS NOT NULL;

  WITH linhas AS (
    -- Material e Equipamento (insumos do estoque). Equipamento = tipo explícito OU categoria do insumo (EQUIP).
    SELECT b.ordem,
      CASE WHEN b.tipo = 'equipamento' OR upper(COALESCE(i.category,'')) LIKE '%EQUIP%' THEN 'equipamento' ELSE 'material' END AS bucket,
      i.erp_code AS codigo, i.name AS descricao, COALESCE(b.unidade, i.unit) AS unidade,
      COALESCE(b.perda_pct,0)::numeric AS perda_pct,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0), 6) AS coeficiente,
      COALESCE(i.current_cost,0)::numeric AS custo_unitario,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(i.current_cost,0), 4) AS custo_no_servico
    FROM projetos_servicos_bom b JOIN m16_insumos i ON i.id = b.insumo_id
    WHERE b.servico_id = p_servico_id AND b.tipo IN ('insumo','equipamento')
    UNION ALL
    -- Mão de obra
    SELECT b.ordem, 'mao_obra' AS bucket,
      mo.codigo AS codigo, COALESCE(mo.funcao, mo.descricao) AS descricao, COALESCE(b.unidade,'h') AS unidade,
      0::numeric AS perda_pct,
      round(b.quantidade, 6) AS coeficiente,
      COALESCE(mo.custo_hora, b.custo_unitario, 0)::numeric AS custo_unitario,
      round(b.quantidade * COALESCE(mo.custo_hora, b.custo_unitario, 0), 4) AS custo_no_servico
    FROM projetos_servicos_bom b LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
    WHERE b.servico_id = p_servico_id AND b.tipo = 'mao_obra'
  ),
  calc AS (
    SELECT l.*,
      -- custo capado (créditos só p/ material/equipamento; MO não credita)
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN custo_no_servico
           ELSE round(custo_no_servico * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0), 4) END AS custo_capado,
      -- impostos de saída
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN round(custo_no_servico * COALESCE(v_cfg.imposto_mo_pct,0)/100.0, 4)
           ELSE round(custo_no_servico * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0)
                      * (COALESCE(v_cfg.icms_pct,0) + COALESCE(v_cfg.pis_cofins_pct,0))/100.0, 4) END AS impostos
    FROM linhas l
  ),
  calc2 AS (
    SELECT c.*,
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN round((custo_capado + impostos) * COALESCE(v_cfg.margem_mo_pct,0)/100.0, 4)
           ELSE round((custo_capado + impostos) * COALESCE(v_cfg.margem_material_pct,0)/100.0, 4) END AS margem
    FROM calc c
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'tipo', bucket, 'codigo', codigo, 'descricao', descricao, 'unidade', unidade,
      'coeficiente', coeficiente, 'perda_pct', perda_pct, 'custo_unitario', custo_unitario,
      'custo_no_servico', round(custo_no_servico,2),
      'custo_capado', round(custo_capado,2), 'impostos', round(impostos,2),
      'margem', round(margem,2),
      'preco_final', CASE WHEN v_has_cfg THEN round(custo_capado + impostos + margem, 2) ELSE NULL END
    ) ORDER BY (bucket='mao_obra'), ordem), '[]'::jsonb),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='material'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='mao_obra'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='equipamento'), 0)
  INTO v_itens, v_cm, v_cmo, v_ceq
  FROM calc2;

  v_ct := round(v_cm + v_cmo + v_ceq, 2);

  -- Cabeçalho de VENDA vem do motor (mesma verdade do simulador · validador Tryo). BDI derivado = markup s/ custo direto.
  IF v_has_cfg THEN
    v_eng := fn_precificar_montagem(p_servico_id, p_company_id, v_srv.business_line_id);
    IF COALESCE((v_eng->>'ok')::boolean, false) THEN
      v_venda := (v_eng->>'total_m2')::numeric;
      v_bdi := CASE WHEN v_ct > 0 AND v_venda IS NOT NULL THEN round((v_venda / v_ct - 1) * 100, 2) ELSE NULL END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'servico', jsonb_build_object('id', v_srv.id, 'codigo', v_srv.codigo, 'nome', v_srv.nome,
       'unidade', v_srv.unidade, 'categoria', v_srv.categoria, 'business_line_id', v_srv.business_line_id),
    'regime_tributario', v_regime,
    'sem_config', NOT v_has_cfg,
    'config', CASE WHEN v_has_cfg THEN jsonb_build_object(
       'creditos_pct', v_cfg.creditos_pct, 'icms_pct', v_cfg.icms_pct, 'pis_cofins_pct', v_cfg.pis_cofins_pct,
       'margem_material_pct', v_cfg.margem_material_pct, 'imposto_mo_pct', v_cfg.imposto_mo_pct,
       'margem_mo_pct', v_cfg.margem_mo_pct, 'comissao_pct', v_cfg.comissao_pct) ELSE NULL END,
    'itens', v_itens,
    'header', jsonb_build_object(
       'custo_material', round(v_cm,2), 'custo_mao_obra', round(v_cmo,2), 'custo_equipamento', round(v_ceq,2),
       'custo_total', v_ct,
       'venda_material', v_eng->'venda_material', 'venda_mo', v_eng->'venda_mo',
       'comissao', v_eng->'comissao', 'custo_fixo_unidade', v_eng->'custo_fixo_m2',
       'preco_venda', v_venda, 'margem_rs', v_eng->'margem_rs', 'margem_pct', v_eng->'margem_pct',
       'bdi_pct', v_bdi)
  );
END $f$;

GRANT EXECUTE ON FUNCTION public.fn_servico_composicao_detalhe(uuid, uuid) TO authenticated;
