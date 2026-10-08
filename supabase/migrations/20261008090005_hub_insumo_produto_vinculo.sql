-- Hub da FC · integração estoque × obra, passo 1 (decisão CEO 06/10, ctx 9f84074b). ADITIVA: tabela e funções NOVAS,
-- nada existente é alterado (RD-26/RD-30).
--
-- Liga o insumo do Hub (m16_insumos, empresa de serviço) ao produto do estoque (erp_produtos, empresa de produto do
-- mesmo grupo). O custo do material passa a ser o VIVO do estoque: custo médio do produto, ou — se a empresa escolher —
-- o MAIOR entre o médio e o da última compra. Sem vínculo, vale o custo do próprio insumo (comportamento de hoje).

CREATE TABLE IF NOT EXISTS public.m16_insumo_produto_vinculo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,                                   -- empresa do insumo (serviço)
  insumo_id   uuid NOT NULL REFERENCES public.m16_insumos(id) ON DELETE CASCADE,
  produto_id  uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE RESTRICT,
  modo_custo  text NOT NULL DEFAULT 'medio' CHECK (modo_custo IN ('medio','maior')),
  criado_por  uuid DEFAULT auth.uid(),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insumo_id)
);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_vinculo_produto_idx ON public.m16_insumo_produto_vinculo (produto_id);
CREATE INDEX IF NOT EXISTS m16_insumo_produto_vinculo_company_idx ON public.m16_insumo_produto_vinculo (company_id);
COMMENT ON TABLE public.m16_insumo_produto_vinculo IS
  'Insumo do Hub → produto do estoque do grupo. modo_custo: medio = preco_custo_medio; maior = maior entre médio e preco_custo (última compra).';

ALTER TABLE public.m16_insumo_produto_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo;
CREATE POLICY m16_insumo_produto_vinculo_empresa ON public.m16_insumo_produto_vinculo
  FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));
REVOKE ALL ON public.m16_insumo_produto_vinculo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m16_insumo_produto_vinculo TO authenticated, service_role;

-- vincular/atualizar (um insumo tem no máximo um produto)
CREATE OR REPLACE FUNCTION public.fn_insumo_vincular_produto(p_insumo uuid, p_produto uuid, p_modo text DEFAULT 'medio')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_prod_company uuid;
BEGIN
  IF p_modo NOT IN ('medio','maior') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido'); END IF;
  SELECT company_id INTO v_company FROM m16_insumos WHERE id = p_insumo;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo_nao_encontrado'); END IF;
  SELECT company_id INTO v_prod_company FROM erp_produtos WHERE id = p_produto;
  IF v_prod_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'produto_nao_encontrado'); END IF;
  IF NOT is_admin() AND NOT (v_company IN (SELECT get_user_company_ids())
                         AND v_prod_company IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  INSERT INTO m16_insumo_produto_vinculo (company_id, insumo_id, produto_id, modo_custo)
  VALUES (v_company, p_insumo, p_produto, p_modo)
  ON CONFLICT (insumo_id) DO UPDATE SET produto_id = EXCLUDED.produto_id, modo_custo = EXCLUDED.modo_custo;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_insumo_vincular_produto(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_vincular_produto(uuid, uuid, text) TO authenticated, service_role;

-- custo vivo + saldo do insumo (leitura, uma linha por chamada — nunca em varredura)
CREATE OR REPLACE FUNCTION public.fn_insumo_custo_vivo(p_insumo uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
DECLARE i m16_insumos%ROWTYPE; v m16_insumo_produto_vinculo%ROWTYPE; p erp_produtos%ROWTYPE; v_custo numeric;
BEGIN
  SELECT * INTO i FROM m16_insumos WHERE id = p_insumo;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo_nao_encontrado'); END IF;
  SELECT * INTO v FROM m16_insumo_produto_vinculo WHERE insumo_id = p_insumo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'origem', 'insumo', 'custo', COALESCE(i.current_cost, 0)); END IF;
  SELECT * INTO p FROM erp_produtos WHERE id = v.produto_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'origem', 'insumo', 'custo', COALESCE(i.current_cost, 0), 'aviso', 'produto_sem_acesso'); END IF;
  v_custo := CASE v.modo_custo
               WHEN 'maior' THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
               ELSE COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0) END;
  RETURN jsonb_build_object('ok', true, 'origem', 'estoque', 'modo_custo', v.modo_custo, 'custo', v_custo,
                            'produto_id', p.id, 'produto', p.nome, 'saldo', COALESCE(p.estoque_atual, 0));
END $function$;
REVOKE ALL ON FUNCTION public.fn_insumo_custo_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insumo_custo_vivo(uuid) TO authenticated, service_role;
