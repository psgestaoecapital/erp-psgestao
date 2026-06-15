-- =============================================================
-- fn_conciliacao_buscar_lancamentos · busca por faixa de valor
-- =============================================================
-- Permite buscar lancamentos (erp_pagar/erp_receber) por:
--   - natureza (debito -> pagar, credito -> receber)
--   - faixa de valor (min/max opcional)
--   - termo (contraparte ou descricao, opcional)
--   - valor_ref: ordena por proximidade (|valor - ref|)
--
-- Marca cada candidato com `ja_conciliado` (EXISTS em
-- conciliacao_movimento status='conciliado') · UI pode mostrar badge
-- "ja vinculado".
--
-- Read-only, STABLE. GRANT EXECUTE pra authenticated.
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_conciliacao_buscar_lancamentos(
  p_company_id uuid,
  p_natureza   text,
  p_valor_min  numeric DEFAULT NULL,
  p_valor_max  numeric DEFAULT NULL,
  p_termo      text    DEFAULT NULL,
  p_valor_ref  numeric DEFAULT NULL,
  p_limite     int     DEFAULT 50
)
RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date,
  valor_lancamento numeric, contraparte text, descricao_lancamento text,
  status text, ja_conciliado boolean)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT 'erp_pagar'::text tab, p.id, p.data_vencimento::date dt, p.valor::numeric val,
           p.fornecedor_nome::text contrap,
           COALESCE(p.descricao,p.fornecedor_nome,'')::text descr, p.status::text st
    FROM erp_pagar p
    WHERE p.company_id = p_company_id AND p_natureza = 'debito'
    UNION ALL
    SELECT 'erp_receber', r.id, r.data_vencimento::date, r.valor,
           r.cliente_nome, COALESCE(r.descricao,r.cliente_nome,''), r.status
    FROM erp_receber r
    WHERE r.company_id = p_company_id AND p_natureza = 'credito'
  )
  SELECT b.tab, b.id, b.dt, b.val, b.contrap, b.descr, b.st,
    EXISTS(SELECT 1 FROM conciliacao_movimento cm
      WHERE cm.lancamento_id=b.id AND cm.lancamento_tabela=b.tab AND cm.status='conciliado')
  FROM base b
  WHERE (p_valor_min IS NULL OR b.val >= p_valor_min)
    AND (p_valor_max IS NULL OR b.val <= p_valor_max)
    AND (p_termo IS NULL OR b.contrap ILIKE '%'||p_termo||'%' OR b.descr ILIKE '%'||p_termo||'%')
  ORDER BY CASE WHEN p_valor_ref IS NOT NULL THEN abs(b.val - p_valor_ref) ELSE 0 END, b.dt DESC
  LIMIT p_limite;
$$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_buscar_lancamentos(uuid,text,numeric,numeric,text,numeric,int) TO authenticated;
