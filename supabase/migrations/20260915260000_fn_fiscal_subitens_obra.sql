-- ============================================================
-- NFS-e · #18 · subitens de tributação por grupo LC116 (para o SELETOR na emissão)
-- ============================================================
-- O código de tributação VARIA POR NOTA (Rodrigo: "07.02.01 ou 07.02.02, depende do tipo de obra").
-- A emissão precisa OFERECER os subitens do grupo LC116 do serviço. A lista vem de tabela
-- (erp_fiscal_servico_obra_obrigatoria, os subitens E0370), nunca chumbada. Genérico por company_id.
CREATE OR REPLACE FUNCTION public.fn_fiscal_subitens_obra(p_company_id uuid, p_codigo_lc116 text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao) ORDER BY codigo), '[]'::jsonb)
  FROM public.erp_fiscal_servico_obra_obrigatoria
  WHERE ativo AND (company_id IS NULL OR company_id = p_company_id)
    -- grupo = 4 primeiros dígitos do LC116 do serviço (ex '07.02' -> '0702'); subitens '0702NN'
    AND left(codigo, 4) = left(regexp_replace(COALESCE(p_codigo_lc116,''),'[^0-9]','','g'), 4)
    AND length(regexp_replace(COALESCE(p_codigo_lc116,''),'[^0-9]','','g')) >= 4;
$fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_subitens_obra(uuid, text) TO authenticated;
