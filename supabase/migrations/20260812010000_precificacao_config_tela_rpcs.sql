-- ============================================================
-- Hub de Projetos · Tela de Premissas de Precificação (editável).
-- RPCs de leitura/escrita de erp_precificacao_config por empresa/linha, consumidas pela aba
-- "Precificação" em /dashboard/projetos/configuracoes. Tudo editável (princípio CEO). RLS já na tabela.
-- ============================================================

-- A.1 — LER premissas de uma empresa (todas as linhas + "empresa toda")
CREATE OR REPLACE FUNCTION public.fn_precificacao_config_obter(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bl.id, 'nome', bl.name) ORDER BY bl.ln_number)
                        FROM business_lines bl WHERE bl.company_id = p_company_id AND bl.is_active), '[]'::jsonb),
    'config', COALESCE((SELECT jsonb_agg(row_to_json(p) ORDER BY p.business_line_id NULLS FIRST)
                        FROM erp_precificacao_config p WHERE p.company_id = p_company_id AND p.ativo), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $f$;

-- A.2 — SALVAR (upsert) premissas de uma (empresa, linha)
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
    updated_at = now()
  WHERE company_id = p_company_id AND ativo
    AND (business_line_id IS NOT DISTINCT FROM p_business_line_id)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN  -- não existia → cria
    INSERT INTO public.erp_precificacao_config
      (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
       margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, base_custo_fixo)
    VALUES (p_company_id, p_business_line_id,
      (p_premissas->>'custo_folha_hora')::numeric, (p_premissas->>'tempo_m2_min')::numeric,
      (p_premissas->>'imposto_mo_pct')::numeric, (p_premissas->>'margem_mo_pct')::numeric,
      (p_premissas->>'margem_material_pct')::numeric, (p_premissas->>'icms_pct')::numeric,
      (p_premissas->>'pis_cofins_pct')::numeric, (p_premissas->>'creditos_pct')::numeric,
      (p_premissas->>'comissao_pct')::numeric, (p_premissas->>'meta_producao_m2')::numeric,
      COALESCE(p_premissas->>'base_custo_fixo','meta'))
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $f$;
