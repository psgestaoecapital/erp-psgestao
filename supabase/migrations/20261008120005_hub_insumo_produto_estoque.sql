-- VIRADA FC · (a) estoque × obra · F1: vínculo do insumo do Hub (m16_insumos) com o produto do estoque
-- da empresa de PRODUTO do mesmo grupo (ctx 9f84074b, decisão CEO 06/10). ADITIVA: tabela nova + função nova.
-- Custo = custo médio do produto; opção 'maior' = maior entre médio e última compra (preco_custo).
CREATE TABLE IF NOT EXISTS public.hub_insumo_produto (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,                 -- empresa de serviço (dona do insumo)
  insumo_id           uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_company_id  uuid NOT NULL,                 -- empresa de produto (mesmo grupo)
  produto_id          uuid NOT NULL REFERENCES public.erp_produtos(id),
  usar_maior_custo    boolean NOT NULL DEFAULT false,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_insumo_produto_insumo ON public.hub_insumo_produto (insumo_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_hub_insumo_produto_company ON public.hub_insumo_produto (company_id);
CREATE INDEX IF NOT EXISTS ix_hub_insumo_produto_produto ON public.hub_insumo_produto (produto_id);
ALTER TABLE public.hub_insumo_produto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_insumo_produto_rw ON public.hub_insumo_produto;
CREATE POLICY hub_insumo_produto_rw ON public.hub_insumo_produto FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids())
    AND EXISTS (SELECT 1 FROM public.dashboard_grupos_empresas a
                JOIN public.dashboard_grupos_empresas b ON b.grupo_id = a.grupo_id
                WHERE a.company_id = hub_insumo_produto.company_id
                  AND b.company_id = hub_insumo_produto.produto_company_id));
REVOKE ALL ON public.hub_insumo_produto FROM anon;

-- Custo vivo do insumo (SECURITY INVOKER: respeita a RLS de quem chama; uma linha por chamada, sem varredura).
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_custo(p_insumo_id uuid)
 RETURNS numeric
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN v.usar_maior_custo
              THEN GREATEST(COALESCE(p.preco_custo_medio,0), COALESCE(p.preco_custo,0))
              ELSE COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0) END
  FROM public.hub_insumo_produto v
  JOIN public.erp_produtos p ON p.id = v.produto_id
  WHERE v.insumo_id = p_insumo_id AND v.ativo
$$;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_custo(uuid) TO authenticated, service_role;
