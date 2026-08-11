-- ============================================================
-- Hub de Projetos · Sprint S2.1 — Mão de Obra POR PRODUTO (correção do S2) + Tela de Produtividade.
-- O S2 (#958) usava tempo uniforme da config (80 min p/ todo produto). Agora a MO nasce do BOM
-- de mão de obra POR PRODUTO (Σ horas × custo/hora vivo da função), com fallback à premissa quando
-- o produto não tem MO no BOM. Cada produto sai com sua MO. Tudo editável (produtividade na grade,
-- valor por função no Catálogo). Base já existia (RD-26): projetos_servicos_bom tipo='mao_obra' +
-- projetos_mao_obra + projetos_servicos.produtividade_unidade_dia.
-- ============================================================

-- A — Motor de MO por produto (substitui o corpo do S2)
CREATE OR REPLACE FUNCTION public.fn_precificar_montagem_mao_obra(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_cfg RECORD; v_custo_mo numeric := 0; v_horas numeric := 0;
  v_imposto numeric; v_mo_ci numeric; v_margem numeric; v_venda numeric;
  v_fonte text; v_itens jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = p_business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = p_business_line_id) DESC NULLS LAST, vigencia_inicio DESC LIMIT 1;
  IF v_cfg.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_config_precificacao'); END IF;

  -- FONTE 1 (verdade): BOM de mão de obra POR PRODUTO = Σ (horas × custo_hora vivo da função)
  SELECT
    COALESCE(SUM(b.quantidade * COALESCE(mo.custo_hora, b.custo_unitario, 0)), 0),
    COALESCE(SUM(b.quantidade), 0),
    jsonb_agg(jsonb_build_object('funcao', mo.funcao, 'horas_m2', b.quantidade,
       'custo_hora', COALESCE(mo.custo_hora, b.custo_unitario),
       'custo', round(b.quantidade * COALESCE(mo.custo_hora, b.custo_unitario,0),2)) ORDER BY b.ordem)
  INTO v_custo_mo, v_horas, v_itens
  FROM projetos_servicos_bom b
  LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
  WHERE b.servico_id = p_servico_id AND b.tipo = 'mao_obra';

  IF v_custo_mo > 0 THEN
    v_fonte := 'bom_por_produto';
  ELSE
    -- FALLBACK: produto sem MO no BOM → usa a premissa (tempo uniforme × folha/hora)
    v_horas    := COALESCE(v_cfg.tempo_m2_min,0)/60.0;
    v_custo_mo := v_horas * COALESCE(v_cfg.custo_folha_hora,0);
    v_fonte    := 'fallback_config';
    v_itens    := '[]'::jsonb;
  END IF;

  v_imposto := v_custo_mo * COALESCE(v_cfg.imposto_mo_pct,0)/100.0;   -- por fora (consistente S1)
  v_mo_ci   := v_custo_mo + v_imposto;
  v_margem  := v_mo_ci * COALESCE(v_cfg.margem_mo_pct,0)/100.0;
  v_venda   := v_mo_ci + v_margem;

  RETURN jsonb_build_object('ok', true, 'fonte', v_fonte, 'horas_m2', round(v_horas,4),
    'custo_mo', round(v_custo_mo,2), 'imposto_mo', round(v_imposto,2), 'mo_com_imposto', round(v_mo_ci,2),
    'margem_mo', round(v_margem,2), 'venda_mo', round(v_venda,2), 'itens', v_itens);
END $f$;

-- B — RPCs da Tela de Produtividade
-- Grade por linha: produtos + produtividade + MO/m²
CREATE OR REPLACE FUNCTION public.fn_produtividade_por_linha_obter(
  p_company_id uuid, p_categoria text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'produtos', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'servico_id', s.id, 'nome', s.nome, 'unidade', s.unidade, 'categoria', s.categoria,
      'produtividade_dia', s.produtividade_unidade_dia, 'equipe', s.equipe_padrao,
      'mo_custo_m2', COALESCE((SELECT SUM(b.quantidade*COALESCE(mo.custo_hora,b.custo_unitario,0))
                    FROM projetos_servicos_bom b LEFT JOIN projetos_mao_obra mo ON mo.id=b.mao_obra_id
                    WHERE b.servico_id=s.id AND b.tipo='mao_obra'),0)
    ) ORDER BY s.categoria, s.nome)
    FROM projetos_servicos s
    WHERE s.company_id=p_company_id AND s.ativo AND (p_categoria IS NULL OR s.categoria=p_categoria)
  ), '[]'::jsonb));
END $f$;

-- Salvar produtividade de um produto
CREATE OR REPLACE FUNCTION public.fn_servico_produtividade_salvar(
  p_servico_id uuid, p_company_id uuid, p_produtividade_dia numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  UPDATE projetos_servicos SET produtividade_unidade_dia = p_produtividade_dia, updated_at=now()
   WHERE id=p_servico_id AND company_id=p_company_id;
  RETURN jsonb_build_object('ok', FOUND);
END $f$;
