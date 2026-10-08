-- Hub da obra · integração estoque × obra, passo 1 (CEO 06/10, ctx 9f84074b): o insumo do Hub (m16_insumos) passa a
-- apontar para o produto do estoque da empresa de produto do grupo (ex.: FCR), para o custo vir vivo do estoque.
-- Só objetos NOVOS (aditiva). Escrita só por função com guarda; leitura por empresa.
--   fn_hub_insumo_vincular_produto(insumo, produto, usar_maior_custo) → grava/atualiza o vínculo
--   fn_hub_insumo_custo(insumo)  → custo do material: CUSTO MÉDIO do produto vinculado, ou o MAIOR entre médio e
--                                   última compra quando o vínculo pede; sem vínculo, cai no custo do próprio insumo.

CREATE TABLE IF NOT EXISTS public.hub_insumo_produto (
  insumo_id        uuid PRIMARY KEY REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  produto_id       uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE RESTRICT,
  usar_maior_custo boolean NOT NULL DEFAULT false,
  criado_por       uuid DEFAULT auth.uid(),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_company_idx ON public.hub_insumo_produto (company_id);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_produto_idx ON public.hub_insumo_produto (produto_id);

ALTER TABLE public.hub_insumo_produto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_insumo_produto_ler ON public.hub_insumo_produto;
CREATE POLICY hub_insumo_produto_ler ON public.hub_insumo_produto
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.hub_insumo_produto FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hub_insumo_produto TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_hub_insumo_vincular_produto(p_insumo_id uuid, p_produto_id uuid, p_usar_maior_custo boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i record; p record;
BEGIN
  SELECT id, company_id INTO i FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(i.company_id);
  SELECT id, company_id INTO p FROM erp_produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'produto_nao_encontrado'); END IF;
  -- o produto pode ser de outra empresa, mas o usuário precisa ter acesso a ela (empresa de produto do mesmo grupo)
  PERFORM public.fn__guarda_empresa(p.company_id);
  INSERT INTO hub_insumo_produto (insumo_id, company_id, produto_id, usar_maior_custo)
  VALUES (i.id, i.company_id, p.id, COALESCE(p_usar_maior_custo, false))
  ON CONFLICT (insumo_id) DO UPDATE SET produto_id = EXCLUDED.produto_id,
    usar_maior_custo = EXCLUDED.usar_maior_custo, atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_vincular_produto(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_vincular_produto(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_hub_insumo_custo(p_insumo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i record; v record; v_custo numeric; v_origem text;
BEGIN
  SELECT id, company_id, current_cost, last_cost INTO i FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(i.company_id);
  SELECT h.usar_maior_custo, p.preco_custo_medio, p.preco_custo, p.estoque_atual INTO v
    FROM hub_insumo_produto h JOIN erp_produtos p ON p.id = h.produto_id WHERE h.insumo_id = i.id;
  IF FOUND AND COALESCE(v.preco_custo_medio, v.preco_custo) IS NOT NULL THEN
    v_custo := CASE WHEN v.usar_maior_custo THEN GREATEST(COALESCE(v.preco_custo_medio, 0), COALESCE(v.preco_custo, 0))
                    ELSE COALESCE(v.preco_custo_medio, v.preco_custo) END;
    v_origem := CASE WHEN v.usar_maior_custo THEN 'estoque_maior_custo' ELSE 'estoque_custo_medio' END;
    RETURN jsonb_build_object('ok', true, 'custo', v_custo, 'origem', v_origem, 'saldo', v.estoque_atual);
  END IF;
  RETURN jsonb_build_object('ok', true, 'custo', COALESCE(i.current_cost, i.last_cost), 'origem', 'insumo', 'saldo', NULL);
END $$;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_custo(uuid) TO authenticated, service_role;
