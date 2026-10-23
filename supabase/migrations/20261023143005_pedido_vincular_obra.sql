-- Hub · resultado por obra (FC Pisos): o pedido de venda precisa gravar o vínculo com a obra para a v_obra_resultado
-- enxergar a receita. Hoje erp_pedidos.obra_id existe, mas nenhum fluxo o preenche (0 linhas em 19/10).
-- Aditiva: uma função nova de guarda; não altera dado existente. Só mexe em erp_pedidos.obra_id (nada fiscal/cliente).
-- Pedido e obra podem ser de empresas diferentes do mesmo usuário (venda da FCR de obra da FC): o usuário precisa
-- ter acesso às duas.
CREATE OR REPLACE FUNCTION public.fn_pedido_vincular_obra(p_pedido_id uuid, p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ped record; v_obra record; v_ant uuid;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para vincular o pedido à obra.');
  END IF;
  SELECT id, company_id, numero, obra_id INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Pedido não encontrado.'); END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND v_ped.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este pedido.');
  END IF;
  IF p_obra_id IS NOT NULL THEN
    SELECT id, company_id, numero INTO v_obra FROM projetos_obras WHERE id = p_obra_id;
    IF v_obra.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
    IF auth.role() <> 'service_role' AND NOT public.is_admin()
       AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta obra.');
    END IF;
  END IF;
  v_ant := v_ped.obra_id;
  IF v_ant IS NOT DISTINCT FROM p_obra_id THEN
    RETURN jsonb_build_object('ok', true, 'alterado', false, 'obra_id', p_obra_id);
  END IF;
  UPDATE erp_pedidos SET obra_id = p_obra_id, updated_at = now() WHERE id = p_pedido_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_ped.company_id, auth.uid(), 'erp_pedidos', p_pedido_id::text, 'vincular_obra',
          jsonb_build_object('obra_id', v_ant), jsonb_build_object('obra_id', p_obra_id));
  RETURN jsonb_build_object('ok', true, 'alterado', true, 'obra_id', p_obra_id, 'pedido', v_ped.numero);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pedido_vincular_obra(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_vincular_obra(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_pedido_vincular_obra(uuid, uuid) IS
  'Hub · liga (ou desliga, com NULL) o pedido de venda a uma obra; alimenta a receita da v_obra_resultado. Audita em audit_log_global.';
