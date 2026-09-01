-- Oficina · Bloco A Path 1 — a peça COMPRADA na NF-e ensina a peça DIGITADA na OS.
-- A Jordana reordenou a fila (A antes de D): "para a reserva dar certo, a vinculação das peças
-- no recebimento da NF precisa funcionar primeiro — para que as peças reservadas sejam de itens
-- que constam no estoque e não textos livres na OS". 413 peças texto-livre contra 1 vinculada;
-- reserva sem vínculo não tem o que segurar.
--
-- ACHADO (RD-38): fn_nfe_item_vincular_os JÁ aceita p_diag_item_id, mas fazia SÓ a direção inversa
-- (lia produto_id DO diag e gravava NA NF). Para a peça texto-livre da OS (produto_id NULL) isso
-- nunca gravava nada de volta no diag — exatamente o vínculo que o Bloco D precisa. A tela também
-- sempre passava p_diag_item_id = NULL.
--
-- CORREÇÃO (RD-30, sem regressão): mantém a direção antiga (NF herda do diag quando a NF ainda não
-- tem produto) E acrescenta a direção que a Jordana pediu — quando a NF TEM produto, o diag alvo é
-- peça texto-livre (produto_id NULL) e a OS ainda não foi faturada, grava produto_id no diag.
-- NÃO sobrescreve vínculo de peça já existente e NÃO toca no preço (decisão: valor de venda é
-- preenchido manualmente pelo atendente).

CREATE OR REPLACE FUNCTION public.fn_nfe_item_vincular_os(p_item_id uuid, p_os_id uuid, p_diag_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item RECORD; v_os RECORD; v_diag RECORD; v_vinc text; v_diag_vinculado boolean := false;
BEGIN
  SELECT i.*, n.company_id AS nfe_company
    INTO v_item
    FROM erp_nfe_recebidas_itens i
    JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_item.nfe_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id AND company_id = v_item.nfe_company;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;

  -- item de diagnóstico alvo (opcional): tem de pertencer à MESMA OS e empresa
  IF p_diag_item_id IS NOT NULL THEN
    SELECT * INTO v_diag FROM erp_os_diagnostico_item
     WHERE id = p_diag_item_id AND os_id = p_os_id AND company_id = v_item.nfe_company;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_diagnostico_nao_encontrado'); END IF;
  END IF;

  -- vínculo NF→OS (comportamento existente, RD-30): grava o rótulo do vínculo e, se a NF ainda
  -- NÃO tem produto, herda do diag (direção antiga preservada — a NF aprende com o diag).
  v_vinc := 'os:' || p_os_id::text || COALESCE(':diag:' || p_diag_item_id::text, '');
  UPDATE erp_nfe_recebidas_itens
     SET vinculo_origem = v_vinc,
         produto_id = COALESCE(produto_id, v_diag.produto_id)
   WHERE id = p_item_id;

  -- [Bloco A Path 1] direção nova: a NF ensina a peça digitada. Só quando a NF TEM produto,
  -- o diag alvo é peça texto-livre (produto_id NULL) e a OS ainda não foi faturada → habilita a
  -- reserva/baixa do Bloco D. Não sobrescreve vínculo existente; não toca no preço.
  IF p_diag_item_id IS NOT NULL
     AND v_item.produto_id IS NOT NULL
     AND v_diag.produto_id IS NULL
     AND v_diag.tipo IN ('peca','peça','produto')
     AND NOT COALESCE(v_os.titulos_gerados, false) THEN
    UPDATE erp_os_diagnostico_item SET produto_id = v_item.produto_id WHERE id = p_diag_item_id;
    v_diag_vinculado := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'vinculo_origem', v_vinc, 'os_numero', v_os.numero,
                            'diag_vinculado', v_diag_vinculado);
END $function$;
