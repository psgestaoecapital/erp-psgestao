-- Editar / Excluir EPI em "Meus EPIs".
-- Editar e Reativar são UPDATE direto (a RLS de epi_catalogo já permite ao tenant alterar os próprios
-- não-globais). Aqui só o EXCLUIR precisa de RPC: soft-delete (RD-55, reversível) + contagem de
-- dependências (ficha/estoque/movimentação/alerta) pra avisar que o histórico é preservado. Pilar 2.
CREATE OR REPLACE FUNCTION public.fn_epi_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_co uuid; v_global boolean; v_nome text; v_achou boolean := false;
  v_ficha int := 0; v_estoque int := 0; v_mov int := 0; v_alerta int := 0; v_total int;
BEGIN
  SELECT true, company_id, is_global, nome INTO v_achou, v_co, v_global, v_nome
  FROM epi_catalogo WHERE id = p_id;
  IF NOT v_achou THEN RETURN jsonb_build_object('ok', false, 'erro', 'EPI não encontrado'); END IF;
  IF v_global IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'EPI global não pode ser excluído pela empresa'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a este EPI'); END IF;

  SELECT count(*) INTO v_ficha   FROM epi_ficha        WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_estoque FROM epi_estoque      WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_mov     FROM epi_movimentacao WHERE catalogo_id = p_id;
  SELECT count(*) INTO v_alerta  FROM epi_alerta       WHERE catalogo_id = p_id;
  v_total := v_ficha + v_estoque + v_mov + v_alerta;

  UPDATE epi_catalogo SET ativo = false, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object(
    'ok', true, 'nome', v_nome, 'tinha_historico', (v_total > 0),
    'deps', jsonb_build_object('ficha', v_ficha, 'estoque', v_estoque, 'movimentacao', v_mov, 'alerta', v_alerta));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_epi_excluir(uuid) TO authenticated;
