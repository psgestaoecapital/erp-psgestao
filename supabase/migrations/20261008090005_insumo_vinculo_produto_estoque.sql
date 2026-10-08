-- FC Pisos / Virada 01/11 (a): insumo do Hub -> produto do estoque do grupo.
-- ADITIVA: coluna nova (nullable) + função nova, SECURITY INVOKER (RLS das tabelas continua valendo).
ALTER TABLE public.m16_insumos
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.erp_produtos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custo_modo text NOT NULL DEFAULT 'medio'
    CHECK (custo_modo IN ('medio','maior'));

CREATE INDEX IF NOT EXISTS m16_insumos_produto_id_idx ON public.m16_insumos(produto_id) WHERE produto_id IS NOT NULL;

COMMENT ON COLUMN public.m16_insumos.produto_id IS 'Produto do estoque (empresa de produto do grupo) que dá custo e saldo vivos ao insumo.';
COMMENT ON COLUMN public.m16_insumos.custo_modo IS 'medio = custo médio do produto; maior = maior entre médio e última compra.';

-- Custo unitário vivo do insumo: do produto vinculado; sem vínculo, cai no current_cost do catálogo.
CREATE OR REPLACE FUNCTION public.fn_insumo_custo_vivo(p_insumo_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN i.produto_id IS NULL THEN COALESCE(i.current_cost, 0)
    WHEN i.custo_modo = 'maior' THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
    ELSE COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)
  END
  FROM public.m16_insumos i
  LEFT JOIN public.erp_produtos p ON p.id = i.produto_id
  WHERE i.id = p_insumo_id;
$$;

REVOKE ALL ON FUNCTION public.fn_insumo_custo_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_vivo(uuid) TO authenticated;
