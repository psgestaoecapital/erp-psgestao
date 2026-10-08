-- Hub · integração estoque × obra, passo 1 (CEO 06/10, ctx 9f84074b): insumo do Hub → produto do estoque do GRUPO.
-- O custo do material na composição = CUSTO MÉDIO do produto da empresa de produto do mesmo grupo; opção "maior"
-- usa o maior entre médio e último custo de compra. Aditiva: tabela nova + 3 funções; nada existente é alterado.
-- Escrita só pelas funções (RLS sem INSERT/UPDATE/DELETE); a empresa do produto tem de ser a do insumo ou do mesmo grupo.

CREATE TABLE IF NOT EXISTS public.erp_insumo_produto_vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),          -- empresa dona do insumo (serviço)
  insumo_id uuid NOT NULL REFERENCES public.m16_insumos(id),
  produto_company_id uuid NOT NULL REFERENCES public.companies(id),  -- empresa de produto (estoque)
  produto_id uuid NOT NULL REFERENCES public.erp_produtos(id),
  modo_custo text NOT NULL DEFAULT 'medio' CHECK (modo_custo IN ('medio', 'maior')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_insumo_produto_vinculo ON public.erp_insumo_produto_vinculo (insumo_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS ix_insumo_produto_vinculo_company ON public.erp_insumo_produto_vinculo (company_id);
CREATE INDEX IF NOT EXISTS ix_insumo_produto_vinculo_produto ON public.erp_insumo_produto_vinculo (produto_id);

ALTER TABLE public.erp_insumo_produto_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumo_produto_vinculo_select ON public.erp_insumo_produto_vinculo;
CREATE POLICY insumo_produto_vinculo_select ON public.erp_insumo_produto_vinculo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_insumo_produto_vinculo FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.erp_insumo_produto_vinculo FROM authenticated;
GRANT SELECT ON public.erp_insumo_produto_vinculo TO authenticated;

-- empresas do mesmo grupo (ou a própria)
CREATE OR REPLACE FUNCTION public.fn__mesmo_grupo(p_a uuid, p_b uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM companies c1 JOIN companies c2
                   ON c2.id = c1.id OR (c1.group_id IS NOT NULL AND c2.group_id = c1.group_id)
                  WHERE c1.id = p_a AND c2.id = p_b)
$function$;
REVOKE ALL ON FUNCTION public.fn__mesmo_grupo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__mesmo_grupo(uuid, uuid) TO authenticated, service_role;

-- vincula (ou troca o vínculo de) um insumo a um produto do estoque do grupo
CREATE OR REPLACE FUNCTION public.fn_insumo_vincular_produto(p_insumo_id uuid, p_produto_id uuid, p_modo_custo text DEFAULT 'medio')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ins m16_insumos%ROWTYPE; v_prod erp_produtos%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login obrigatório'; END IF;
  IF p_modo_custo NOT IN ('medio', 'maior') THEN RAISE EXCEPTION 'modo de custo inválido (medio|maior)'; END IF;
  SELECT * INTO v_ins FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'insumo não encontrado'; END IF;
  IF NOT (v_ins.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'sem acesso ao insumo'; END IF;
  SELECT * INTO v_prod FROM erp_produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'produto não encontrado'; END IF;
  IF NOT public.fn__mesmo_grupo(v_ins.company_id, v_prod.company_id) THEN
    RAISE EXCEPTION 'o produto precisa ser de empresa do mesmo grupo do insumo'; END IF;
  UPDATE erp_insumo_produto_vinculo SET ativo = false WHERE insumo_id = p_insumo_id AND ativo;
  INSERT INTO erp_insumo_produto_vinculo (company_id, insumo_id, produto_company_id, produto_id, modo_custo)
  VALUES (v_ins.company_id, p_insumo_id, v_prod.company_id, p_produto_id, p_modo_custo) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_insumo_vincular_produto(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_vincular_produto(uuid, uuid, text) TO authenticated, service_role;

-- custo vivo do insumo a partir do estoque (médio, ou o maior entre médio e último custo) + saldo
CREATE OR REPLACE FUNCTION public.fn_insumo_custo_estoque(p_insumo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_custo numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login obrigatório'; END IF;
  SELECT vi.company_id, vi.modo_custo, p.id produto_id, p.nome, p.unidade, p.preco_custo_medio, p.preco_custo, p.estoque_atual
    INTO v
    FROM erp_insumo_produto_vinculo vi JOIN erp_produtos p ON p.id = vi.produto_id
   WHERE vi.insumo_id = p_insumo_id AND vi.ativo;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'vinculado', false); END IF;
  IF NOT (v.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'sem acesso ao insumo'; END IF;
  v_custo := CASE WHEN v.modo_custo = 'maior'
                  THEN GREATEST(COALESCE(v.preco_custo_medio, 0), COALESCE(v.preco_custo, 0))
                  ELSE COALESCE(NULLIF(v.preco_custo_medio, 0), v.preco_custo) END;
  RETURN jsonb_build_object('ok', true, 'vinculado', true, 'produto_id', v.produto_id, 'produto', v.nome,
    'unidade', v.unidade, 'modo_custo', v.modo_custo, 'custo', v_custo, 'saldo', v.estoque_atual);
END $function$;
REVOKE ALL ON FUNCTION public.fn_insumo_custo_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_estoque(uuid) TO authenticated, service_role;
