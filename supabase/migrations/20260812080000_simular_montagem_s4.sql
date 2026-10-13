-- ============================================================
-- Hub de Projetos · Sprint S4 — Simulador de Obra (a estrela).
-- Escolha a montagem → metragem → quantitativo de materiais (BOM × área × (1+perda)) + orçamento
-- das 5 camadas (reusa fn_precificar_montagem) + total da obra. Registra a rota no module_catalog.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_simular_montagem(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL, p_area numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_preco jsonb; v_quant jsonb; v_nome text; v_unidade text; v_area numeric;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  v_area := GREATEST(COALESCE(p_area,0), 0);

  SELECT nome, unidade INTO v_nome, v_unidade FROM projetos_servicos WHERE id=p_servico_id;

  -- preço por m² (as 5 camadas) — reusa o motor
  v_preco := fn_precificar_montagem(p_servico_id, p_company_id, p_business_line_id);
  IF (v_preco->>'ok')::bool IS NOT TRUE THEN RETURN v_preco; END IF;

  -- QUANTITATIVO de materiais = BOM (insumos) × área × (1+perda)
  SELECT jsonb_agg(jsonb_build_object(
     'insumo', i.name, 'unidade', b.unidade,
     'qtd_m2', b.quantidade,
     'qtd_total', round(b.quantidade * (1+COALESCE(b.perda_pct,0)/100.0) * v_area, 3),
     'custo_total', round(b.quantidade*(1+COALESCE(b.perda_pct,0)/100.0)*COALESCE(i.current_cost,0)*v_area,2)
   ) ORDER BY b.ordem)
  INTO v_quant
  FROM projetos_servicos_bom b JOIN m16_insumos i ON i.id=b.insumo_id
  WHERE b.servico_id=p_servico_id AND b.tipo='insumo';

  RETURN jsonb_build_object('ok', true,
    'montagem', v_nome, 'unidade', v_unidade, 'area', v_area,
    'preco_m2', v_preco,
    'total_obra', round(COALESCE((v_preco->>'total_m2')::numeric,0) * v_area, 2),
    'quantitativo', COALESCE(v_quant,'[]'::jsonb));
END $f$;

-- Registra a rota no menu (grupo hub, superfície hub, ícone calculadora)
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, subgrupo, layer, surface_in_groups)
SELECT gen_random_uuid(), 'Simulador de Obra', 'hub', '🧮', '/dashboard/projetos/simulador', 123, true,
  'Escolha a montagem + metragem → quantitativo de materiais + orçamento das 5 camadas.',
  'projetos_engenharia', '2_svc', ARRAY['hub']
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog WHERE rota='/dashboard/projetos/simulador');
