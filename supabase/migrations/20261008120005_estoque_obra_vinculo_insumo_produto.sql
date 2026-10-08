-- FC Pisos · Virada 01/11 · estoque × obra (a) — decisão do CEO 06/10 (ctx 9f84074b). Faixa de migration 05 (gilberto-produto).
-- Passo 1, ADITIVO: liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de
-- produto do mesmo grupo). Custo do material = custo médio do produto, com opção "maior" (maior entre médio e custo da última compra).
-- Só objeto novo; nenhum UPDATE/DELETE em dado de cliente. RLS por empresa; sem acesso do anon.

CREATE TABLE IF NOT EXISTS public.m16_insumo_produto_vinculo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),            -- dona do insumo (empresa de serviço)
  insumo_id     uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id    uuid NOT NULL REFERENCES public.erp_produtos(id),         -- produto da empresa de produto do grupo
  opcao_custo   text NOT NULL DEFAULT 'medio' CHECK (opcao_custo IN ('medio','maior')),
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT m16_insumo_produto_vinculo_insumo_key UNIQUE (insumo_id)
);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_vinculo_produto_idx ON public.m16_insumo_produto_vinculo (produto_id);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_vinculo_company_idx ON public.m16_insumo_produto_vinculo (company_id);
COMMENT ON TABLE public.m16_insumo_produto_vinculo IS
  'Insumo do Hub (empresa de serviço) → produto do estoque (empresa de produto do grupo). Custo vivo do produto, opção medio|maior (CEO 06/10).';

ALTER TABLE public.m16_insumo_produto_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.m16_insumo_produto_vinculo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.m16_insumo_produto_vinculo TO authenticated;
GRANT ALL ON TABLE public.m16_insumo_produto_vinculo TO service_role;

-- o usuário precisa enxergar a empresa do insumo E a empresa do produto (mesmo grupo = ambas no seu acesso)
DROP POLICY IF EXISTS m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo;
CREATE POLICY m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (
    company_id IN (SELECT public.get_user_company_ids())
    AND EXISTS (SELECT 1 FROM public.m16_insumos i WHERE i.id = insumo_id AND i.company_id = m16_insumo_produto_vinculo.company_id)
    AND EXISTS (SELECT 1 FROM public.erp_produtos p WHERE p.id = produto_id
                  AND p.company_id IN (SELECT public.get_user_company_ids()))
  );

-- custo vivo do insumo vinculado (SECURITY INVOKER: a RLS do chamador vale)
CREATE OR REPLACE FUNCTION public.fn_insumo_custo_vinculado(p_insumo_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $function$
  SELECT CASE v.opcao_custo
           WHEN 'maior' THEN GREATEST(COALESCE(p.preco_custo_medio,0), COALESCE(p.preco_custo,0))
           ELSE COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0)
         END
    FROM public.m16_insumo_produto_vinculo v
    JOIN public.erp_produtos p ON p.id = v.produto_id
   WHERE v.insumo_id = p_insumo_id AND v.ativo
$function$;
REVOKE ALL ON FUNCTION public.fn_insumo_custo_vinculado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_vinculado(uuid) TO authenticated, service_role;
