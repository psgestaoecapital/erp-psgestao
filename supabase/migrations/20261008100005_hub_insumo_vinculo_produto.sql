-- Hub × estoque do grupo (CEO 06/10, ctx 9f84074b) — PASSO 1: insumo do Hub -> produto do estoque (empresa de produto).
--  1) erp_insumo_produto_vinculo: liga m16_insumos (empresa de serviço) a erp_produtos (empresa de produto do mesmo grupo).
--     Um insumo tem no máximo um produto; modo_custo = 'medio' (padrão) ou 'maior' (maior entre custo médio e última compra).
--  2) fn_insumo_custo_vivo(insumo): custo unitário vivo do produto vinculado; sem vínculo devolve o custo do catálogo.
-- Aditivo: objetos novos, RLS ligada, policy por empresa, REVOKE anon. Nenhum dado de cliente alterado.

CREATE TABLE IF NOT EXISTS public.erp_insumo_produto_vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  insumo_id uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.erp_produtos(id),
  modo_custo text NOT NULL DEFAULT 'medio' CHECK (modo_custo IN ('medio', 'maior')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insumo_id)
);
CREATE INDEX IF NOT EXISTS idx_insumo_produto_vinculo_produto ON public.erp_insumo_produto_vinculo(produto_id);
CREATE INDEX IF NOT EXISTS idx_insumo_produto_vinculo_company ON public.erp_insumo_produto_vinculo(company_id);

ALTER TABLE public.erp_insumo_produto_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumo_produto_vinculo_empresa ON public.erp_insumo_produto_vinculo;
CREATE POLICY insumo_produto_vinculo_empresa ON public.erp_insumo_produto_vinculo
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids())
    AND EXISTS (SELECT 1 FROM public.erp_produtos p
                  JOIN public.companies cp ON cp.id = p.company_id
                  JOIN public.companies cv ON cv.id = erp_insumo_produto_vinculo.company_id
                 WHERE p.id = erp_insumo_produto_vinculo.produto_id AND cp.org_id IS NOT DISTINCT FROM cv.org_id));
REVOKE ALL ON public.erp_insumo_produto_vinculo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_insumo_produto_vinculo TO authenticated;
GRANT ALL ON public.erp_insumo_produto_vinculo TO service_role;

CREATE OR REPLACE FUNCTION public.fn_insumo_custo_vivo(p_insumo_id uuid)
 RETURNS TABLE(custo numeric, origem text, produto_id uuid, modo_custo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN v.id IS NOT NULL THEN
           CASE WHEN v.modo_custo = 'maior'
                THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
                ELSE COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0) END
         ELSE COALESCE(i.current_cost, 0) END::numeric(14,4),
         CASE WHEN v.id IS NOT NULL THEN 'estoque' ELSE 'catalogo' END,
         v.produto_id,
         v.modo_custo
    FROM public.m16_insumos i
    LEFT JOIN public.erp_insumo_produto_vinculo v ON v.insumo_id = i.id
    LEFT JOIN public.erp_produtos p ON p.id = v.produto_id
   WHERE i.id = p_insumo_id
     AND i.company_id IN (SELECT public.get_user_company_ids());
$function$;
REVOKE ALL ON FUNCTION public.fn_insumo_custo_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_vivo(uuid) TO authenticated, service_role;
