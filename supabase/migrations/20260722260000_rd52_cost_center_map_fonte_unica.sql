-- RD-52: cost_center_map = FONTE DA VERDADE do mapeamento de centro de custo.
-- Estende (aditivo) p/ cobrir o caso pecuário; descarta a duplicata vazia (erp_centro_custo_mapa);
-- repointa o importador e a listagem. api/custos/processar só usa source_type
-- omie_departamento/omie_categoria/cnpj -> nao regride (provado por digest antes/depois da Tryo).

ALTER TABLE public.cost_center_map DROP CONSTRAINT IF EXISTS cost_center_map_source_type_check;
ALTER TABLE public.cost_center_map ADD CONSTRAINT cost_center_map_source_type_check
  CHECK (source_type = ANY (ARRAY['omie_departamento','omie_categoria','nibo_centro','nibo_categoria',
    'contaazul_categoria','contaazul_centro','bling_deposito','bling_categoria','cnpj','manual','industrial','centro_custo']));

ALTER TABLE public.cost_center_map
  ADD COLUMN IF NOT EXISTS tipo_apropriacao text,
  ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES public.erp_pec_lote(id);
ALTER TABLE public.cost_center_map DROP CONSTRAINT IF EXISTS cost_center_map_tipo_apropriacao_check;
ALTER TABLE public.cost_center_map ADD CONSTRAINT cost_center_map_tipo_apropriacao_check
  CHECK (tipo_apropriacao IS NULL OR tipo_apropriacao = ANY (ARRAY['direto','comum','extra']));

DROP TABLE IF EXISTS public.erp_centro_custo_mapa;

COMMENT ON TABLE public.centros_custo IS 'RD-30/RD-52: candidata a DROP (0 registros, 0 referencias no codigo em 2026-07-22). NAO dropar ainda — tabela vazia pode ser reserva. Ver cost_center_map (fonte da verdade do mapeamento) e erp_centros_custo (cadastro nomeado).';

CREATE OR REPLACE FUNCTION public.fn_pec_custo_importar_do_pagar(p_company uuid, p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ins int; v_revisar int; v_pendentes jsonb;
BEGIN
  WITH cand AS (
    SELECT p.id, p.descricao, p.valor, p.centro_custo, p.categoria,
           COALESCE(p.data_pagamento, p.data_vencimento) AS competencia,
           m.tipo_apropriacao AS m_tipo, m.lote_id AS m_lote, m.business_line_id AS m_bl,
           (m.id IS NOT NULL) AS mapeado
    FROM erp_pagar p
    LEFT JOIN LATERAL (
      SELECT cm.tipo_apropriacao, cm.lote_id, cm.business_line_id, cm.id
      FROM cost_center_map cm
      WHERE cm.company_id = p.company_id AND cm.ativo
        AND cm.source_type = 'centro_custo'
        AND cm.source_key = COALESCE(p.centro_custo,'')
      ORDER BY cm.priority DESC NULLS LAST LIMIT 1
    ) m ON TRUE
    WHERE p.company_id = p_company
      AND COALESCE(p.data_pagamento, p.data_vencimento) BETWEEN p_ini AND p_fim
      AND p.centro_custo IS NOT NULL AND btrim(p.centro_custo) <> ''
  ),
  ins AS (
    INSERT INTO erp_pec_custo_lancamento
      (company_id, lote_id, business_line_id, tipo_apropriacao, categoria, descricao, valor,
       data_competencia, origem, origem_ref_id, revisar, observacao)
    SELECT p_company,
      CASE WHEN mapeado THEN m_lote ELSE NULL END,
      CASE WHEN mapeado THEN m_bl ELSE NULL END,
      CASE WHEN mapeado AND m_tipo IS NOT NULL THEN m_tipo ELSE 'extra' END,
      CASE WHEN categoria ~* 'nutri|ração|racao|sal|milho|silag' THEN 'nutricao'
           WHEN categoria ~* 'sanid|vacin|vermi|medic|veterin'    THEN 'sanidade'
           WHEN categoria ~* 'reprod|insemin|semen|touro'         THEN 'reproducao'
           WHEN categoria ~* 'mao|salario|folha|funcion'          THEN 'mao_obra'
           WHEN categoria ~* 'pasto|pastagem|semente|aduba'       THEN 'pastagem'
           WHEN categoria ~* 'arrend'                              THEN 'arrendamento'
           WHEN categoria ~* 'maquin|trator|combust|diesel'       THEN 'maquinas'
           WHEN categoria ~* 'admin|contab|escrit'                THEN 'administrativo'
           ELSE 'outro' END,
      COALESCE(descricao, 'Importado do financeiro'), COALESCE(valor, 0), competencia,
      'erp_pagar', id::text,
      (NOT mapeado OR m_tipo IS NULL),
      'importado de erp_pagar · centro_custo: ' || COALESCE(centro_custo,'(vazio)')
        || CASE WHEN mapeado THEN '' ELSE ' · NÃO MAPEADO (revise)' END
    FROM cand
    ON CONFLICT (company_id, origem, origem_ref_id) WHERE origem_ref_id IS NOT NULL DO NOTHING
    RETURNING revisar
  )
  SELECT count(*), count(*) FILTER (WHERE revisar) INTO v_ins, v_revisar FROM ins;

  SELECT COALESCE(jsonb_agg(DISTINCT p.centro_custo), '[]'::jsonb) INTO v_pendentes
  FROM erp_pagar p
  WHERE p.company_id = p_company
    AND COALESCE(p.data_pagamento, p.data_vencimento) BETWEEN p_ini AND p_fim
    AND p.centro_custo IS NOT NULL AND btrim(p.centro_custo) <> ''
    AND NOT EXISTS (SELECT 1 FROM cost_center_map cm
                    WHERE cm.company_id = p_company AND cm.ativo
                      AND cm.source_type='centro_custo' AND cm.source_key = p.centro_custo);

  RETURN jsonb_build_object('ok', true, 'importados', COALESCE(v_ins,0),
    'em_revisao', COALESCE(v_revisar,0),
    'centros_nao_mapeados', v_pendentes,
    'nota', 'Não mapeado NÃO é adivinhado: entra como extra+revisar. Configure o mapa antes de ratear.');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_centro_custo_valores(p_company uuid)
RETURNS TABLE(valor_origem text, ocorrencias bigint, mapeado boolean, tipo_apropriacao text, business_line_id uuid, lote_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH vals AS (
    SELECT centro_custo AS v, count(*) AS n FROM erp_pagar
      WHERE company_id = p_company AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    SELECT centro_custo AS v, count(*) AS n FROM erp_receber
      WHERE company_id = p_company AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    SELECT source_key AS v, 0::bigint AS n FROM cost_center_map
      WHERE company_id = p_company AND ativo AND source_type='centro_custo'
  ),
  agg AS (SELECT v, SUM(n) AS n FROM vals GROUP BY v)
  SELECT agg.v, agg.n, (m.id IS NOT NULL),
         m.tipo_apropriacao, m.business_line_id, m.lote_id
  FROM agg
  LEFT JOIN LATERAL (
    SELECT cm.id, cm.tipo_apropriacao, cm.business_line_id, cm.lote_id
    FROM cost_center_map cm
    WHERE cm.company_id = p_company AND cm.ativo AND cm.source_type='centro_custo' AND cm.source_key = agg.v
    ORDER BY cm.priority DESC NULLS LAST LIMIT 1
  ) m ON TRUE
  ORDER BY (m.id IS NOT NULL), agg.n DESC;
$$;
