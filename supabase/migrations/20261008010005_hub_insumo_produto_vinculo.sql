-- Virada FC (01/11) · integração estoque × obra, passo (a)-1 (gilberto-produto). Migration ADITIVA (RD-94.1c).
-- Liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de produto do
-- mesmo grupo). Custo do material = custo médio do produto; opção "maior custo" = maior entre médio e custo (última compra).
CREATE TABLE IF NOT EXISTS public.m16_insumo_produto_vinculo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,               -- empresa de serviço dona do insumo
  insumo_id         uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_company_id uuid NOT NULL,              -- empresa de produto (estoque)
  produto_id        uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE CASCADE,
  usar_maior_custo  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT m16_insumo_produto_vinculo_insumo_key UNIQUE (insumo_id)
);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_vinculo_produto_idx ON public.m16_insumo_produto_vinculo (produto_id);
COMMENT ON TABLE public.m16_insumo_produto_vinculo IS
  'Insumo do Hub -> produto do estoque do grupo (custo e saldo vivos). Um produto por insumo.';

ALTER TABLE public.m16_insumo_produto_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.m16_insumo_produto_vinculo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.m16_insumo_produto_vinculo TO authenticated;
GRANT ALL ON TABLE public.m16_insumo_produto_vinculo TO service_role;
DROP POLICY IF EXISTS m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo;
CREATE POLICY m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo
  FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));

-- Custo vivo do insumo vinculado (INVOKER: a RLS de quem chama vale). NULL = sem vínculo.
CREATE OR REPLACE FUNCTION public.fn_insumo_custo_estoque(p_insumo_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN v.usar_maior_custo
              THEN GREATEST(COALESCE(p.preco_custo_medio,0), COALESCE(p.preco_custo,0))
              ELSE COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo) END
  FROM public.m16_insumo_produto_vinculo v
  JOIN public.erp_produtos p ON p.id = v.produto_id
  WHERE v.insumo_id = p_insumo_id
$function$;
REVOKE ALL ON FUNCTION public.fn_insumo_custo_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_estoque(uuid) TO authenticated, service_role;
