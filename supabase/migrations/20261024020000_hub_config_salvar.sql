-- PDCA Hub · /dashboard/projetos/configuracoes (gilberto-desenv, 24/10).
-- A tabela projetos_modulo_config só tem policy de SELECT: o autosave da tela (UPDATE direto pelo navegador)
-- nunca gravou nada — e ainda mandava bdi_administracao_central_pct/bdi_garantia_pct, nomes que não existem
-- (as colunas são bdi_admin_central_pct/bdi_garantias_pct). Gravação passa a ser por esta RPC, com a mesma guarda
-- da fn_projetos_aplicar_preset_bdi (empresa do usuário). Aditiva: função NOVA; nada é alterado em dado existente.
-- O gatilho trg_bdi_recalcular segue recalculando bdi_total_pct.

CREATE FUNCTION public.fn_projetos_config_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_row projetos_modulo_config%ROWTYPE;
  v_num text[] := ARRAY['bdi_admin_central_pct','bdi_seguros_pct','bdi_riscos_pct','bdi_garantias_pct',
                        'bdi_despesas_financeiras_pct','bdi_lucro_pct','bdi_impostos_pct',
                        'margem_alvo_pct','margem_minima_pct'];
  v_k text;
  v_v numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;

  -- Percentuais: 0 a 100; impostos abaixo de 100 (a fórmula divide por 1 - IM).
  FOREACH v_k IN ARRAY v_num LOOP
    IF p_dados ? v_k AND p_dados->>v_k IS NOT NULL THEN
      v_v := (p_dados->>v_k)::numeric;
      IF v_v < 0 OR v_v > 100 OR (v_k = 'bdi_impostos_pct' AND v_v >= 100) THEN
        RAISE EXCEPTION 'Percentual fora da faixa: % = %', v_k, v_v USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF (p_dados ? 'validade_proposta_dias' AND (p_dados->>'validade_proposta_dias')::int < 0)
     OR (p_dados ? 'prazo_pagamento_padrao_dias' AND (p_dados->>'prazo_pagamento_padrao_dias')::int < 0) THEN
    RAISE EXCEPTION 'Prazo em dias não pode ser negativo' USING ERRCODE = '22023';
  END IF;

  INSERT INTO projetos_modulo_config (company_id) VALUES (p_company_id) ON CONFLICT (company_id) DO NOTHING;

  -- Só as chaves enviadas mudam; ausente ou nulo mantém o valor atual.
  UPDATE projetos_modulo_config c SET
    bdi_admin_central_pct        = COALESCE((p_dados->>'bdi_admin_central_pct')::numeric, c.bdi_admin_central_pct),
    bdi_seguros_pct              = COALESCE((p_dados->>'bdi_seguros_pct')::numeric, c.bdi_seguros_pct),
    bdi_riscos_pct               = COALESCE((p_dados->>'bdi_riscos_pct')::numeric, c.bdi_riscos_pct),
    bdi_garantias_pct            = COALESCE((p_dados->>'bdi_garantias_pct')::numeric, c.bdi_garantias_pct),
    bdi_despesas_financeiras_pct = COALESCE((p_dados->>'bdi_despesas_financeiras_pct')::numeric, c.bdi_despesas_financeiras_pct),
    bdi_lucro_pct                = COALESCE((p_dados->>'bdi_lucro_pct')::numeric, c.bdi_lucro_pct),
    bdi_impostos_pct             = COALESCE((p_dados->>'bdi_impostos_pct')::numeric, c.bdi_impostos_pct),
    margem_alvo_pct              = COALESCE((p_dados->>'margem_alvo_pct')::numeric, c.margem_alvo_pct),
    margem_minima_pct            = COALESCE((p_dados->>'margem_minima_pct')::numeric, c.margem_minima_pct),
    validade_proposta_dias       = COALESCE((p_dados->>'validade_proposta_dias')::int, c.validade_proposta_dias),
    prazo_pagamento_padrao_dias  = COALESCE((p_dados->>'prazo_pagamento_padrao_dias')::int, c.prazo_pagamento_padrao_dias),
    prefixo_orcamento            = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_orcamento')), ''), c.prefixo_orcamento),
    prefixo_obra                 = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_obra')), ''), c.prefixo_obra),
    prefixo_proposta             = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_proposta')), ''), c.prefixo_proposta),
    vendedor_pode_alterar_preco    = COALESCE((p_dados->>'vendedor_pode_alterar_preco')::boolean, c.vendedor_pode_alterar_preco),
    vendedor_pode_aprovar_proposta = COALESCE((p_dados->>'vendedor_pode_aprovar_proposta')::boolean, c.vendedor_pode_aprovar_proposta),
    updated_at = now()
  WHERE c.company_id = p_company_id
  RETURNING c.* INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

COMMENT ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) IS
  'Grava a configuração do módulo Projetos (BDI, margens, prazos, prefixos, permissões do vendedor) da empresa do usuário. Integrações Omie e aprovação do engenheiro ainda não são gravadas (sem consumidor).';

REVOKE ALL ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) TO authenticated, service_role;
