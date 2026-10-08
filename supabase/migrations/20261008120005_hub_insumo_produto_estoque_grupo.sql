-- FC Pisos · Virada 01/11 · (a) integração estoque × obra, passo 1 (CEO 06/10, ctx 9f84074b). Faixa 05 (gilberto-produto).
-- Liga o insumo do Hub (m16_insumos, empresa de SERVIÇO) ao produto do estoque (erp_produtos, empresa de PRODUTO do grupo)
-- e dá o custo vivo do insumo: CUSTO MÉDIO do produto, ou o MAIOR entre médio e última compra (opção do orçamento).
-- ADITIVA: tabela e função novas, RLS ligada, policy por empresa, REVOKE anon. Não altera dado de cliente.

CREATE TABLE IF NOT EXISTS public.m16_insumo_produto (
  insumo_id          uuid PRIMARY KEY REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,                                   -- empresa do insumo (serviço)
  produto_id         uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE RESTRICT,
  produto_company_id uuid NOT NULL,                                   -- empresa do produto (estoque do grupo)
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_produto_idx ON public.m16_insumo_produto (produto_id);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_company_idx ON public.m16_insumo_produto (company_id);
COMMENT ON TABLE public.m16_insumo_produto IS
  'Vínculo insumo do Hub (empresa de serviço) → produto do estoque (empresa de produto do mesmo grupo). Custo e saldo vêm do produto.';

ALTER TABLE public.m16_insumo_produto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.m16_insumo_produto FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.m16_insumo_produto TO authenticated;
GRANT ALL ON TABLE public.m16_insumo_produto TO service_role;
DROP POLICY IF EXISTS p_m16_insumo_produto ON public.m16_insumo_produto;
CREATE POLICY p_m16_insumo_produto ON public.m16_insumo_produto FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (
    (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
    AND (produto_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
    AND EXISTS (SELECT 1 FROM public.m16_insumos i WHERE i.id = insumo_id AND i.company_id = m16_insumo_produto.company_id)
    AND EXISTS (SELECT 1 FROM public.erp_produtos p WHERE p.id = produto_id AND p.company_id = m16_insumo_produto.produto_company_id)
  );

-- custo vivo do insumo: 'medio' (padrão) | 'maior' (maior entre custo médio e custo da última compra)
CREATE OR REPLACE FUNCTION public.fn_custo_insumo_estoque(p_insumo_id uuid, p_modo text DEFAULT 'medio')
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE r record; v_custo numeric;
BEGIN
  IF p_modo NOT IN ('medio','maior') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido');
  END IF;
  SELECT v.produto_id, p.preco_custo_medio AS medio, p.preco_custo AS ultimo, p.estoque_atual
    INTO r
  FROM m16_insumo_produto v JOIN erp_produtos p ON p.id = v.produto_id
  WHERE v.insumo_id = p_insumo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_vinculo');
  END IF;
  v_custo := CASE WHEN p_modo = 'maior' THEN GREATEST(COALESCE(r.medio,0), COALESCE(r.ultimo,0))
                  ELSE COALESCE(NULLIF(r.medio,0), r.ultimo, 0) END;
  RETURN jsonb_build_object('ok', true, 'produto_id', r.produto_id, 'modo', p_modo,
    'custo', round(v_custo,4), 'custo_medio', r.medio, 'custo_ultima_compra', r.ultimo, 'saldo', r.estoque_atual);
END $function$;
REVOKE ALL ON FUNCTION public.fn_custo_insumo_estoque(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_custo_insumo_estoque(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_custo_insumo_estoque(uuid, text) IS
  'Custo vivo do insumo do Hub a partir do produto do estoque vinculado (SECURITY INVOKER: respeita a RLS do usuário). modo medio|maior.';
