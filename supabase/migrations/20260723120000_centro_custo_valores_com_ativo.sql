-- fn_centro_custo_valores passa a expor o estado `ativo` do mapa e a listar inativos,
-- p/ a tela mostrar "inativo" + reativar (excluir/inativar/reativar). Assinatura muda -> DROP+CREATE.
DROP FUNCTION IF EXISTS public.fn_centro_custo_valores(uuid);
CREATE FUNCTION public.fn_centro_custo_valores(p_company uuid)
RETURNS TABLE(valor_origem text, ocorrencias bigint, mapeado boolean, ativo boolean,
              tipo_apropriacao text, business_line_id uuid, lote_id uuid)
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
      WHERE company_id = p_company AND source_type='centro_custo'
  ),
  agg AS (SELECT v, SUM(n) AS n FROM vals GROUP BY v)
  SELECT agg.v, agg.n, (m.id IS NOT NULL), COALESCE(m.ativo, false),
         m.tipo_apropriacao, m.business_line_id, m.lote_id
  FROM agg
  LEFT JOIN LATERAL (
    SELECT cm.id, cm.ativo, cm.tipo_apropriacao, cm.business_line_id, cm.lote_id
    FROM cost_center_map cm
    WHERE cm.company_id = p_company AND cm.source_type='centro_custo' AND cm.source_key = agg.v
    ORDER BY cm.ativo DESC, cm.priority DESC NULLS LAST LIMIT 1
  ) m ON TRUE
  ORDER BY (m.id IS NOT NULL AND m.ativo), agg.n DESC;
$$;
