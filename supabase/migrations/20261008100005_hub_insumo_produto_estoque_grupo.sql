-- Hub da FC Pisos · (a) integração estoque × obra, PASSO 1 (CEO 06/10, ctx 9f84074b). Faixa 05 (gilberto-produto).
-- ADITIVA: tabela nova + função nova, RLS ligada, policy por empresa, REVOKE anon. Nenhum UPDATE/DELETE em dado de cliente.
-- Liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de produto do
-- mesmo grupo) e dá o custo vivo: MÉDIO por padrão, ou o MAIOR entre médio e última compra (opção por empresa).

CREATE TABLE IF NOT EXISTS public.hub_insumo_produto (
  insumo_id   uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id  uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,                 -- empresa dona do insumo (serviço)
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (insumo_id)
);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_produto_idx ON public.hub_insumo_produto (produto_id);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_company_idx ON public.hub_insumo_produto (company_id);
COMMENT ON TABLE public.hub_insumo_produto IS
  'Insumo do Hub (m16_insumos) → produto do estoque do grupo (erp_produtos). Um insumo aponta para um produto; custo e saldo vêm vivos do produto.';

ALTER TABLE public.hub_insumo_produto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_insumo_produto FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hub_insumo_produto TO authenticated;
GRANT ALL ON TABLE public.hub_insumo_produto TO service_role;
DROP POLICY IF EXISTS hub_insumo_produto_rls ON public.hub_insumo_produto;
CREATE POLICY hub_insumo_produto_rls ON public.hub_insumo_produto FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.hub_custo_config (
  company_id        uuid PRIMARY KEY,
  usar_maior_custo  boolean NOT NULL DEFAULT false,  -- false = custo médio; true = maior(médio, última compra)
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hub_custo_config IS
  'Opção por empresa de serviço: custo do material = médio (padrão) ou o MAIOR entre médio e última compra.';
ALTER TABLE public.hub_custo_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_custo_config FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.hub_custo_config TO authenticated;
GRANT ALL ON TABLE public.hub_custo_config TO service_role;
DROP POLICY IF EXISTS hub_custo_config_rls ON public.hub_custo_config;
CREATE POLICY hub_custo_config_rls ON public.hub_custo_config FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Custo vivo do insumo (SECURITY INVOKER: a RLS do usuário continua valendo; sem produto ligado devolve o custo do catálogo)
CREATE OR REPLACE FUNCTION public.fn_hub_custo_insumo(p_insumo_id uuid) RETURNS numeric
 LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN v.produto_id IS NULL THEN i.current_cost
    WHEN COALESCE(c.usar_maior_custo, false)
      THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
    ELSE COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo)
  END
  FROM public.m16_insumos i
  LEFT JOIN public.hub_insumo_produto v ON v.insumo_id = i.id
  LEFT JOIN public.erp_produtos p ON p.id = v.produto_id
  LEFT JOIN public.hub_custo_config c ON c.company_id = i.company_id
  WHERE i.id = p_insumo_id
$function$;
REVOKE ALL ON FUNCTION public.fn_hub_custo_insumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_custo_insumo(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_hub_custo_insumo(uuid) IS
  'Custo vivo do insumo do Hub: produto do estoque ligado (médio, ou maior de médio/última compra conforme hub_custo_config); sem vínculo, current_cost.';
