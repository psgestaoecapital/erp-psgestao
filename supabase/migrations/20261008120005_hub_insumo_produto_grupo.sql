-- Hub × Estoque do grupo (decisão CEO 06/10, ctx 9f84074b) — ETAPA 1, ADITIVA:
-- liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de produto do
-- MESMO grupo/org), com a opção de custo: 'medio' (custo médio) ou 'maior' (maior entre médio e última compra).
-- Só objetos novos; nenhum dado existente é alterado.

CREATE TABLE IF NOT EXISTS public.hub_insumo_produto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.erp_produtos(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),          -- empresa dona do insumo (serviço)
  company_produto_id uuid NOT NULL REFERENCES public.companies(id),  -- empresa dona do produto (estoque)
  opcao_custo text NOT NULL DEFAULT 'medio' CHECK (opcao_custo IN ('medio', 'maior')),
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insumo_id)
);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_produto_idx ON public.hub_insumo_produto (produto_id);
CREATE INDEX IF NOT EXISTS hub_insumo_produto_company_idx ON public.hub_insumo_produto (company_id);

ALTER TABLE public.hub_insumo_produto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_insumo_produto_empresa ON public.hub_insumo_produto;
CREATE POLICY hub_insumo_produto_empresa ON public.hub_insumo_produto FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.hub_insumo_produto FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hub_insumo_produto TO authenticated;
GRANT ALL ON public.hub_insumo_produto TO service_role;

-- vincula (ou troca) o produto de um insumo; valida empresa do usuário e mesmo grupo (org_id)
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_vincular_produto(p_insumo_id uuid, p_produto_id uuid, p_opcao text DEFAULT 'medio')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ins_company uuid; v_prod_company uuid; v_org_a uuid; v_org_b uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login obrigatório'; END IF;
  IF p_opcao NOT IN ('medio', 'maior') THEN RAISE EXCEPTION 'opção de custo inválida'; END IF;
  SELECT company_id INTO v_ins_company FROM m16_insumos WHERE id = p_insumo_id;
  IF v_ins_company IS NULL THEN RAISE EXCEPTION 'insumo não encontrado'; END IF;
  IF NOT (v_ins_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RAISE EXCEPTION 'sem acesso ao insumo'; END IF;
  SELECT company_id INTO v_prod_company FROM erp_produtos WHERE id = p_produto_id;
  IF v_prod_company IS NULL THEN RAISE EXCEPTION 'produto não encontrado'; END IF;
  SELECT org_id INTO v_org_a FROM companies WHERE id = v_ins_company;
  SELECT org_id INTO v_org_b FROM companies WHERE id = v_prod_company;
  IF v_org_a IS NULL OR v_org_a IS DISTINCT FROM v_org_b THEN RAISE EXCEPTION 'produto de outro grupo'; END IF;
  INSERT INTO hub_insumo_produto (insumo_id, produto_id, company_id, company_produto_id, opcao_custo)
  VALUES (p_insumo_id, p_produto_id, v_ins_company, v_prod_company, p_opcao)
  ON CONFLICT (insumo_id) DO UPDATE SET produto_id = EXCLUDED.produto_id, company_produto_id = EXCLUDED.company_produto_id,
    opcao_custo = EXCLUDED.opcao_custo;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_vincular_produto(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_vincular_produto(uuid, uuid, text) TO authenticated, service_role;

-- custo vivo do insumo: do produto vinculado (médio, ou o maior entre médio e última compra); sem vínculo = custo do catálogo
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_custo(p_insumo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'insumo_id', i.id,
    'origem', CASE WHEN v.id IS NULL THEN 'catalogo' ELSE 'estoque' END,
    'opcao_custo', v.opcao_custo,
    'saldo', p.estoque_atual,
    'custo', CASE WHEN v.id IS NULL THEN i.current_cost
                  WHEN v.opcao_custo = 'maior' THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
                  ELSE COALESCE(p.preco_custo_medio, p.preco_custo) END)
  FROM m16_insumos i
  LEFT JOIN hub_insumo_produto v ON v.insumo_id = i.id
  LEFT JOIN erp_produtos p ON p.id = v.produto_id
  WHERE i.id = p_insumo_id
    AND (i.company_id IN (SELECT get_user_company_ids()) OR is_admin());
$function$;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_custo(uuid) TO authenticated, service_role;
