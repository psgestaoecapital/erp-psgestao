-- Oficina · fn_os_faturar — conta bancária no faturamento da OS avulsa (3º lugar do mesmo padrão:
-- NF-e recebida #1205, pedido de venda #1211, agora OS). Mesma lacuna: o erp_receber nasce sem
-- saber o banco da cobrança.
--
-- Duas vias:
--  - via PEDIDO (v_os.pedido_id): delega a fn_faturar → a conta já vem das PARCELAS (#1211). Nada muda.
--  - via AVULSA (OS-FIN): insere UM erp_receber direto, sem parcela → a conta é UMA só, escolhida no
--    faturamento. Novo parâmetro OPCIONAL p_conta_bancaria_id (default NULL: quem fatura sem escolher
--    continua funcionando).
-- DROP+CREATE porque a assinatura ganha um parâmetro; chamadas antigas (1 arg) seguem pelo default.

DROP FUNCTION IF EXISTS public.fn_os_faturar(uuid);

CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid, p_conta_bancaria_id uuid DEFAULT NULL)
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
    -- caminho PEDIDO: fn_faturar já cuida do estoque e da conta (vem das parcelas, #1211). Não duplicar aqui.
    v_res := public.fn_faturar(v_os.pedido_id, NULL);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
    END IF;
    v_first := (v_res->'receber_ids'->>0)::uuid;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'pedido', 'os_numero', v_os.numero,
      'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
  ELSE
    -- OS-FIN (#9): garante o total a partir dos itens aprovados antes do gate (OS só-peças destrava).
    PERFORM public.fn_os_recalcular_total_interno(p_os_id);
    SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;

    IF coalesce(v_os.total, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'OS sem valor para faturar (total zerado).');
    END IF;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      numero_documento, observacoes, ref_externa_id, ref_externa_sistema, conta_bancaria_id)
    VALUES (v_os.company_id, v_os.cliente_id, v_os.cliente_nome,
      v_os.numero || ' — ' || coalesce(nullif(btrim(v_os.defeito_relatado), ''), 'serviço'),
      v_os.total, CURRENT_DATE, v_os.numero,
      'Faturamento da OS ' || v_os.numero || ' (oficina)', v_os.id::text, 'oficina_os', p_conta_bancaria_id)
    RETURNING id INTO v_first;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;

    -- BAIXA AUTOMÁTICA (Part 4): peças compradas via NF e vinculadas a ESTA OS saem do estoque.
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

    -- OS-FIN (#7): agora que há título (receita), recalcula o painel custo/lucro na hora.
    PERFORM public.fn_os_snapshot_custo_lucro(p_os_id, false);

    RETURN jsonb_build_object('ok', true, 'via', 'avulsa', 'os_numero', v_os.numero,
      'valor', v_os.total, 'receber_id', v_first, 'lancamento_id', v_first, 'itens_estoque_baixados', v_baixados);
  END IF;
END $function$;
