-- Oficina · Part 4: NF de compra → vínculo item↔OS → baixa automática do estoque no faturamento (RD-26)
--
-- Fecha o ciclo: peça comprada via NF pra a OS entra no estoque (fn_nfe_recebida_dar_entrada_estoque) e,
-- ao FATURAR a OS, sai do estoque automaticamente — sem reconciliação manual. Compras/estoque/NF são
-- monopólio da GE [→GE]; a Oficina só vincula o item à OS e consome o resultado no faturamento.
--
-- AUDITADO (dinheiro + estoque):
--   • fn_os_faturar hoje NÃO mexe estoque no caminho AVULSO (só gera o título a receber). O caminho
--     PEDIDO usa fn_faturar, que JÁ baixa estoque — por isso a saída daqui vale só no avulso (o da
--     oficina/Gean), evitando baixa dupla.
--   • Saída canônica = fn_movimentar_estoque(produto, local, 'saida', ...). A entrada da NF ignora
--     vinculo_origem (só faz entrada por produto_id); o elo OS fica gravado e é consumido aqui.
--   • Idempotente: fn_os_faturar trava por titulos_gerados/lancamento_id → a saída roda uma vez só.
-- ⚠️ Mexe em estoque + faturamento reais → reauditoria profunda pós-merge (RD-53).

-- 1) Vincular um item de NF recebida a uma OS (+ item do diagnóstico). Grava vinculo_origem + produto_id.
CREATE OR REPLACE FUNCTION public.fn_nfe_item_vincular_os(
  p_item_id uuid, p_os_id uuid, p_diag_item_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item RECORD; v_os RECORD; v_diag_prod uuid; v_vinc text;
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

  IF p_diag_item_id IS NOT NULL THEN
    SELECT produto_id INTO v_diag_prod FROM erp_os_diagnostico_item
     WHERE id = p_diag_item_id AND os_id = p_os_id AND company_id = v_item.nfe_company;
  END IF;

  v_vinc := 'os:' || p_os_id::text || COALESCE(':diag:' || p_diag_item_id::text, '');
  UPDATE erp_nfe_recebidas_itens
     SET vinculo_origem = v_vinc,
         produto_id = COALESCE(produto_id, v_diag_prod)   -- não sobrescreve um de-para já fixado
   WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'vinculo_origem', v_vinc, 'os_numero', v_os.numero);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_vincular_os(uuid, uuid, uuid) TO authenticated;

-- 2) fn_os_faturar: no caminho AVULSO, baixa o estoque das peças da NF vinculadas a esta OS.
CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_res jsonb; v_first uuid; v_local uuid; r record; v_baixados int := 0;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.', 'ja_faturada', true);
  END IF;
  IF v_os.status NOT IN ('entregue', 'pronta', 'concluida', 'concluída', 'finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS pronta/entregue pode ser faturada (situação atual: ' || coalesce(v_os.status, '?') || ').');
  END IF;

  IF v_os.pedido_id IS NOT NULL THEN
    -- caminho PEDIDO: fn_faturar já cuida do estoque (não duplicar aqui)
    v_res := public.fn_faturar(v_os.pedido_id, NULL);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
    END IF;
    v_first := (v_res->'receber_ids'->>0)::uuid;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'pedido', 'os_numero', v_os.numero,
      'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
  ELSE
    IF coalesce(v_os.total, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'OS sem valor para faturar (total zerado).');
    END IF;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      numero_documento, observacoes, ref_externa_id, ref_externa_sistema)
    VALUES (v_os.company_id, v_os.cliente_id, v_os.cliente_nome,
      v_os.numero || ' — ' || coalesce(nullif(btrim(v_os.defeito_relatado), ''), 'serviço'),
      v_os.total, CURRENT_DATE, v_os.numero,
      'Faturamento da OS ' || v_os.numero || ' (oficina)', v_os.id::text, 'oficina_os')
    RETURNING id INTO v_first;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;

    -- BAIXA AUTOMÁTICA (Part 4): peças compradas via NF e vinculadas a ESTA OS saem do estoque.
    -- Só as que efetivamente entraram (estoque_movimentado=true) e têm produto_id. Roda uma vez (guard acima).
    v_local := public.fn_estoque_local_principal(v_os.company_id);
    IF v_local IS NOT NULL THEN
      FOR r IN
        SELECT ni.produto_id, ni.quantidade, ni.valor_unitario
          FROM erp_nfe_recebidas_itens ni
         WHERE ni.company_id = v_os.company_id
           AND ni.produto_id IS NOT NULL
           AND COALESCE(ni.estoque_movimentado, false) = true
           AND ni.vinculo_origem LIKE ('os:' || p_os_id::text || '%')
           AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id = ni.produto_id AND p.company_id = v_os.company_id)
      LOOP
        PERFORM public.fn_movimentar_estoque(
          p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
          p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.valor_unitario, 0),
          p_motivo := 'Consumo em OS faturada',
          p_observacoes := 'OS ' || COALESCE(v_os.numero, ''),
          p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
        v_baixados := v_baixados + 1;
      END LOOP;
    END IF;

    RETURN jsonb_build_object('ok', true, 'via', 'avulsa', 'os_numero', v_os.numero,
      'valor', v_os.total, 'receber_id', v_first, 'lancamento_id', v_first, 'itens_estoque_baixados', v_baixados);
  END IF;
END $function$;
