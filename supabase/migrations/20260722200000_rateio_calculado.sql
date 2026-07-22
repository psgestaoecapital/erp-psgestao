-- PARTE 2 — Rateio calculado (nunca digitado). O % é sempre função de um driver físico/receita.
-- RD-51: base total = 0 → vazio com motivo, nunca divide por zero nem assume 100% numa linha.

ALTER TABLE public.rateio_config_empresa
  ADD COLUMN IF NOT EXISTS driver text NOT NULL DEFAULT 'receita'
    CHECK (driver IN ('area','ua','receita','headcount','manual')),
  ADD COLUMN IF NOT EXISTS incluir_area_improdutiva boolean NOT NULL DEFAULT false;

-- fn_rateio_base: distribuição calculada por linha de negócio na data de referência.
CREATE OR REPLACE FUNCTION public.fn_rateio_base(p_company_id uuid, p_data_ref date)
RETURNS TABLE(business_line_id uuid, nome text, base numeric, percentual numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_driver text; v_incluir boolean; v_ini date; v_fim date;
BEGIN
  SELECT COALESCE(driver,'receita'), COALESCE(incluir_area_improdutiva,false)
    INTO v_driver, v_incluir
  FROM rateio_config_empresa WHERE company_id = p_company_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  v_driver := COALESCE(v_driver, 'receita');
  v_incluir := COALESCE(v_incluir, false);
  v_ini := date_trunc('month', p_data_ref)::date;
  v_fim := (date_trunc('month', p_data_ref) + interval '1 month - 1 day')::date;

  RETURN QUERY
  WITH _rb(bl, vbase) AS (
    -- driver=area
    SELECT pa.business_line_id, SUM(pa.area_ha)
    FROM erp_propriedade_area pa
    WHERE v_driver = 'area' AND pa.company_id = p_company_id AND pa.ativo AND pa.entra_rateio
      AND pa.business_line_id IS NOT NULL
      AND (v_incluir OR pa.uso NOT IN ('reserva_legal','app','infraestrutura'))
    GROUP BY pa.business_line_id
    UNION ALL
    -- driver=ua
    SELECT pa.business_line_id, SUM(COALESCE(cua.ua_valor,1.0))
    FROM erp_pec_animal an
    JOIN erp_propriedade_area pa ON pa.id = an.area_atual_id AND pa.business_line_id IS NOT NULL
    LEFT JOIN erp_pec_categoria_ua cua ON cua.company_id = an.company_id AND cua.categoria = an.categoria
    WHERE v_driver = 'ua' AND an.company_id = p_company_id AND an.ativo
    GROUP BY pa.business_line_id
    UNION ALL
    -- driver=headcount
    SELECT bl.id, bl.headcount::numeric
    FROM business_lines bl
    WHERE v_driver = 'headcount' AND bl.company_id = p_company_id
      AND COALESCE(bl.is_active,true) AND COALESCE(bl.headcount,0) > 0
    UNION ALL
    -- driver=receita (mês da data_ref)
    SELECT bl.id, SUM(COALESCE(r.valor_pago, r.valor, 0))
    FROM erp_receber r
    JOIN business_lines bl ON bl.company_id = r.company_id
      AND (lower(bl.name) = lower(btrim(r.linha_negocio)) OR bl.ln_number::text = btrim(r.linha_negocio))
    WHERE v_driver = 'receita' AND r.company_id = p_company_id AND r.status IN ('recebido','pago')
      AND COALESCE(r.data_pagamento, r.data_vencimento) BETWEEN v_ini AND v_fim
    GROUP BY bl.id
    UNION ALL
    -- driver=manual (percentuais em rateio_regras.distribuicao)
    SELECT (kv.key)::uuid, (kv.value)::numeric
    FROM rateio_regras rr, jsonb_each_text(rr.distribuicao) kv
    WHERE v_driver = 'manual' AND rr.company_id = p_company_id AND COALESCE(rr.ativo,true)
      AND kv.key ~ '^[0-9a-fA-F-]{36}$'
  ),
  tot AS (SELECT SUM(vbase) t FROM _rb WHERE vbase > 0),
  r AS (
    SELECT _rb.bl, _rb.vbase,
      ROUND(100 * _rb.vbase / NULLIF((SELECT t FROM tot), 0), 2) AS pct,
      ROW_NUMBER() OVER (ORDER BY _rb.vbase DESC) AS rn
    FROM _rb WHERE _rb.vbase > 0
  ),
  adj AS (
    -- corrige o arredondamento na MAIOR linha para Σ = 100
    SELECT r.bl, r.vbase,
      r.pct + CASE WHEN r.rn = 1 THEN (100 - (SELECT SUM(pct) FROM r)) ELSE 0 END AS pct
    FROM r
  )
  SELECT adj.bl, bl.name, adj.vbase, adj.pct
  FROM adj JOIN business_lines bl ON bl.id = adj.bl
  ORDER BY adj.vbase DESC;
END;
$$;

-- fn_rateio_aplicar: distribui os custos COMUNS do período pela base calculada; devolve a memória.
CREATE OR REPLACE FUNCTION public.fn_rateio_aplicar(p_company_id uuid, p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_total_comum numeric; v_n int; v_mem jsonb; v_driver text;
BEGIN
  SELECT COALESCE(driver,'receita') INTO v_driver FROM rateio_config_empresa
    WHERE company_id = p_company_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  SELECT COALESCE(SUM(valor),0) INTO v_total_comum
  FROM erp_pec_custo_lancamento
  WHERE company_id = p_company_id AND tipo_apropriacao = 'comum'
    AND data_competencia BETWEEN p_ini AND p_fim;

  SELECT count(*), jsonb_agg(jsonb_build_object(
      'business_line_id', b.business_line_id, 'nome', b.nome,
      'base', ROUND(b.base,2), 'percentual', b.percentual,
      'valor_alocado', ROUND(v_total_comum * b.percentual / 100, 2)
    ) ORDER BY b.base DESC)
    INTO v_n, v_mem
  FROM fn_rateio_base(p_company_id, p_fim) b;

  IF v_n IS NULL OR v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false,
      'driver', COALESCE(v_driver,'receita'), 'total_comum', ROUND(v_total_comum,2),
      'motivo', 'nenhuma base elegível para o driver "' || COALESCE(v_driver,'receita') ||
                '" (cadastre áreas/linhas ou receita no período). Nada rateado — RD-51.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'aplicado', true,
    'driver', COALESCE(v_driver,'receita'), 'total_comum', ROUND(v_total_comum,2),
    'linhas', v_n, 'memoria', v_mem);
END;
$$;
