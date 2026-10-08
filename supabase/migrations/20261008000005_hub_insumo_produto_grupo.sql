-- FC Pisos · Virada 01/11 · integração estoque × obra, passo 1 (decisão CEO 06/10, ctx 9f84074b).
-- Liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de produto do
-- mesmo grupo) e entrega o custo vivo: CUSTO MÉDIO do produto, ou o MAIOR entre médio e última compra (opção por vínculo).
-- Aditiva: tabela nova (RLS por empresa, REVOKE anon, sem DELETE, escrita só pela função) + função nova. Nada existente é alterado.
-- Quem vincula precisa ter acesso às DUAS empresas (serviço e produto); a função lê o custo com a mesma guarda.

CREATE TABLE IF NOT EXISTS public.hub_insumo_produto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,   -- empresa de serviço (dona do insumo)
  insumo_id        uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id       uuid NOT NULL REFERENCES public.erp_produtos(id),
  usar_maior_custo boolean NOT NULL DEFAULT false,
  ativo            boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hub_insumo_produto IS
  'Hub × estoque do grupo: insumo (empresa de serviço) → produto do estoque (empresa de produto). Custo vivo via fn_hub_insumo_custo.';
CREATE UNIQUE INDEX IF NOT EXISTS hub_insumo_produto_uk ON public.hub_insumo_produto (insumo_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS hub_insumo_produto_prod_idx ON public.hub_insumo_produto (produto_id);

ALTER TABLE public.hub_insumo_produto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_insumo_produto FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS hub_insumo_produto_empresa ON public.hub_insumo_produto;
-- Escrita SÓ pela fn_hub_insumo_vincular (guarda das duas empresas): INSERT direto aceitaria insumo de outra empresa.
CREATE POLICY hub_insumo_produto_empresa ON public.hub_insumo_produto FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.hub_insumo_produto TO authenticated;
GRANT ALL ON public.hub_insumo_produto TO service_role;

-- Vincular (ou trocar o vínculo) do insumo a um produto do estoque do grupo.
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_vincular(p_insumo_id uuid, p_produto_id uuid, p_usar_maior_custo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_prod_emp uuid; v_id uuid;
BEGIN
  SELECT company_id INTO v_emp FROM m16_insumos WHERE id = p_insumo_id;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo não encontrado'); END IF;
  SELECT company_id INTO v_prod_emp FROM erp_produtos WHERE id = p_produto_id;
  IF v_prod_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'produto não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  PERFORM public.fn__guarda_empresa(v_prod_emp);
  UPDATE hub_insumo_produto SET ativo = false, updated_at = now() WHERE insumo_id = p_insumo_id AND ativo;
  INSERT INTO hub_insumo_produto (company_id, insumo_id, produto_id, usar_maior_custo, created_by)
  VALUES (v_emp, p_insumo_id, p_produto_id, COALESCE(p_usar_maior_custo, false), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- Custo vivo do insumo: médio do produto vinculado (ou o maior entre médio e última compra, se a opção estiver ligada).
-- Sem vínculo: cai no custo do próprio catálogo (m16_insumos.current_cost), marcando a origem.
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_custo(p_insumo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_i m16_insumos%ROWTYPE; v_v hub_insumo_produto%ROWTYPE; v_p erp_produtos%ROWTYPE; v_custo numeric;
BEGIN
  SELECT * INTO v_i FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_i.company_id);
  SELECT * INTO v_v FROM hub_insumo_produto WHERE insumo_id = p_insumo_id AND ativo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'origem', 'catalogo', 'custo', v_i.current_cost);
  END IF;
  SELECT * INTO v_p FROM erp_produtos WHERE id = v_v.produto_id;
  PERFORM public.fn__guarda_empresa(v_p.company_id);
  v_custo := CASE WHEN v_v.usar_maior_custo
                  THEN GREATEST(COALESCE(v_p.preco_custo_medio, 0), COALESCE(v_p.preco_custo, 0))
                  ELSE COALESCE(v_p.preco_custo_medio, v_p.preco_custo) END;
  RETURN jsonb_build_object('ok', true, 'origem', CASE WHEN v_v.usar_maior_custo THEN 'estoque_maior' ELSE 'estoque_medio' END,
    'custo', v_custo, 'produto_id', v_p.id, 'saldo', v_p.estoque_atual);
END $function$;

REVOKE ALL ON FUNCTION public.fn_hub_insumo_vincular(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_vincular(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_custo(uuid) TO authenticated, service_role;
