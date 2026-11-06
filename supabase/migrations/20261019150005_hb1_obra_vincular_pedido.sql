-- HB1 (FC Pisos): fluxo que GRAVA o vínculo venda (pedido) × obra, que alimenta receita_material/custo_material
-- da v_obra_resultado. Hoje erp_pedidos.obra_id = 0 linhas em produção: a view está certa, falta quem vincule.
-- Só objeto NOVO (1 função). Não altera view nem tabela. Plano de volta: DROP FUNCTION fn_obra_vincular_pedido(uuid, uuid)
-- (os vínculos gravados ficam em erp_pedidos.obra_id e podem ser desfeitos com p_obra_id = NULL).
CREATE OR REPLACE FUNCTION public.fn_obra_vincular_pedido(p_pedido_id uuid, p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_obra_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_obra_id IS NOT NULL THEN
    SELECT company_id INTO v_obra_company FROM public.projetos_obras WHERE id = p_obra_id;
    IF v_obra_company IS NULL OR v_obra_company <> v_company THEN
      RAISE EXCEPTION 'Obra não encontrada nesta empresa';
    END IF;
  END IF;
  UPDATE public.erp_pedidos SET obra_id = p_obra_id, updated_at = now() WHERE id = p_pedido_id;
  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id, 'obra_id', p_obra_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_vincular_pedido(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_vincular_pedido(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_vincular_pedido(uuid, uuid) IS
  'HB1 · vincula (ou desvincula, com NULL) uma venda a uma obra da MESMA empresa; alimenta a v_obra_resultado.';
