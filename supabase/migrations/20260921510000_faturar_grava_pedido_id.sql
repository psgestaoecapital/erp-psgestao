-- Faturamento · gravar erp_receber.pedido_id no vínculo do recebível (fonte única, RD-65).
--
-- Defeito: no corpo LEGADO do fn_faturar (pedido SEM previsão), as parcelas de erp_receber eram criadas
-- SEM pedido_id — o vínculo pedido↔recebível vivia só no TEXTO da descrição ("Pedido <numero> - parcela
-- N/M"). Por isso a emissão de NFS-e pelo pedido não achava a parcela pela FK e dependia de casar por
-- texto (ilike na descrição), frágil. (O caminho de PREVISÃO — fn_faturar_efetivar — já grava pedido_id.)
--
-- Correção em duas frentes:
--  1) fn_faturar passa a gravar pedido_id (e pedido_parcela_id, quando há parcela) em toda parcela criada.
--  2) BACKFILL idempotente das parcelas órfãs existentes, casando o NÚMERO do pedido na descrição por
--     TOKEN EXATO — a descrição tem de ser exatamente 'Pedido <numero>' OU começar por
--     'Pedido <numero> - parcela ' — NUNCA substring: 'PED-ORC-346035' jamais casa com 'PED-ORC-3460351',
--     porque o número precisa ser seguido de fim-de-texto ou de ' - parcela '. Só aplica quando há
--     EXATAMENTE 1 pedido correspondente (ambíguo → não toca) e só onde pedido_id ainda é NULL.

-- ── 1) fn_faturar (corpo legado): gravar pedido_id/pedido_parcela_id ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_faturar(p_pedido_id uuid, p_local_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped record; v_local_id uuid; v_item record; v_bom record;
  v_qtd_antes numeric; v_custo numeric; v_qtd_baixa numeric;
  v_cmv numeric := 0; v_movs jsonb := '[]'::jsonb; v_n_mov int := 0;
  v_parc record; v_rec_ids uuid[] := ARRAY[]::uuid[]; v_rec_id uuid; v_n_parc int := 0;
  v_tot_parc int;
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;

  -- ETAPA3: se o pedido já tem PREVISÃO, faturar = EFETIVAR todas as parcelas (não duplica títulos).
  IF EXISTS (SELECT 1 FROM erp_receber WHERE pedido_id=p_pedido_id AND status='previsto' AND deleted_at IS NULL) THEN
    RETURN public.fn_faturar_efetivar(
      p_pedido_id,
      ARRAY(SELECT id FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id ORDER BY numero),
      NULL, NULL, NULL, CURRENT_DATE, p_local_id);
  END IF;

  -- ===== corpo legado (pedido SEM previsão) — INALTERADO (fail-open, cuidado #1) =====
  IF v_ped.status = 'faturado' OR COALESCE(v_ped.titulos_gerados,false) THEN
    RAISE EXCEPTION 'Pedido % ja foi faturado', v_ped.numero;
  END IF;
  IF v_ped.status = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado nao pode ser faturado'; END IF;

  v_local_id := p_local_id;
  IF v_local_id IS NULL THEN
    SELECT id INTO v_local_id FROM erp_estoque_locais
    WHERE company_id = v_ped.company_id AND COALESCE(principal,false)=true AND COALESCE(ativo,true)=true LIMIT 1;
  END IF;
  IF v_local_id IS NULL THEN
    INSERT INTO erp_estoque_locais (company_id, nome, principal, ativo)
    VALUES (v_ped.company_id, 'Estoque Principal', true, true) RETURNING id INTO v_local_id;
  END IF;

  FOR v_item IN
    SELECT tipo_item, produto_id, produto_nome, servico_id, servico_descricao,
           COALESCE(quantidade,0)::numeric AS quantidade
    FROM erp_pedidos_itens WHERE pedido_id = p_pedido_id ORDER BY ordem NULLS LAST, id
  LOOP
    IF v_item.tipo_item = 'produto' AND v_item.produto_id IS NOT NULL AND v_item.quantidade > 0 THEN
      SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
        INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_item.produto_id;
      INSERT INTO erp_estoque_movimentacoes (
        company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
        custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento
      ) VALUES (
        v_ped.company_id, v_item.produto_id, v_local_id, 'venda',
        'Faturamento pedido ' || COALESCE(v_ped.numero,''),
        v_item.quantidade, v_qtd_antes, v_qtd_antes - v_item.quantidade,
        v_custo, v_item.quantidade * v_custo, 'pedido', v_ped.id, v_ped.numero, auth.uid(), now()
      );
      UPDATE erp_produtos SET estoque_atual = v_qtd_antes - v_item.quantidade, updated_at = now()
        WHERE id = v_item.produto_id;
      v_cmv := v_cmv + v_item.quantidade * v_custo; v_n_mov := v_n_mov + 1;
      v_movs := v_movs || jsonb_build_object('origem','produto','produto_id',v_item.produto_id,'nome',v_item.produto_nome,'qtd',v_item.quantidade,'antes',v_qtd_antes,'depois',v_qtd_antes - v_item.quantidade,'custo',v_custo);

    ELSIF v_item.tipo_item = 'servico' AND v_item.servico_id IS NOT NULL THEN
      FOR v_bom IN
        SELECT produto_id, produto_nome, COALESCE(quantidade_padrao,1)::numeric AS qpad
        FROM erp_servicos_produtos WHERE servico_id = v_item.servico_id AND produto_id IS NOT NULL
      LOOP
        v_qtd_baixa := v_bom.qpad * v_item.quantidade;
        IF v_qtd_baixa <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
          INTO v_qtd_antes, v_custo FROM erp_produtos WHERE id = v_bom.produto_id;
        INSERT INTO erp_estoque_movimentacoes (
          company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes, quantidade_depois,
          custo_unitario, valor_total, ref_tipo, ref_id, ref_numero, usuario_id, data_movimento
        ) VALUES (
          v_ped.company_id, v_bom.produto_id, v_local_id, 'venda',
          'Faturamento pedido ' || COALESCE(v_ped.numero,'') || ' (BOM ' || COALESCE(v_item.servico_descricao,'servico') || ')',
          v_qtd_baixa, v_qtd_antes, v_qtd_antes - v_qtd_baixa,
          v_custo, v_qtd_baixa * v_custo, 'pedido', v_ped.id, v_ped.numero, auth.uid(), now()
        );
        UPDATE erp_produtos SET estoque_atual = v_qtd_antes - v_qtd_baixa, updated_at = now()
          WHERE id = v_bom.produto_id;
        v_cmv := v_cmv + v_qtd_baixa * v_custo; v_n_mov := v_n_mov + 1;
        v_movs := v_movs || jsonb_build_object('origem','bom_servico','servico_id',v_item.servico_id,'produto_id',v_bom.produto_id,'nome',v_bom.produto_nome,'qtd',v_qtd_baixa,'antes',v_qtd_antes,'depois',v_qtd_antes - v_qtd_baixa,'custo',v_custo);
      END LOOP;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_tot_parc FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;
  IF v_tot_parc > 0 THEN
    -- FIX-FATURAR-PEDIDO-ID-v1: seleciona também o id da parcela e grava pedido_id + pedido_parcela_id.
    FOR v_parc IN SELECT id AS parcela_id, numero, valor, vencimento, forma_pagamento, conta_bancaria_id
                  FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id ORDER BY numero
    LOOP
      INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
        valor, status, categoria, numero_documento, descricao, forma_pagamento, conta_bancaria_id,
        pedido_id, pedido_parcela_id, created_at)
      VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE, v_parc.vencimento,
        v_parc.valor, 'aberto', 'Receita de vendas',
        COALESCE(v_ped.numero,'') || ' ' || v_parc.numero || '/' || v_tot_parc,
        'Pedido ' || COALESCE(v_ped.numero,'') || ' - parcela ' || v_parc.numero || '/' || v_tot_parc,
        v_parc.forma_pagamento, v_parc.conta_bancaria_id,
        p_pedido_id, v_parc.parcela_id, now())
      RETURNING id INTO v_rec_id;
      v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := v_n_parc + 1;
    END LOOP;
  ELSE
    -- FIX-FATURAR-PEDIDO-ID-v1: título único também carimba o pedido_id.
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, pedido_id, created_at)
    VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, CURRENT_DATE,
      COALESCE(v_ped.primeiro_vencimento, CURRENT_DATE), v_ped.total, 'aberto', 'Receita de vendas',
      v_ped.numero, 'Pedido ' || COALESCE(v_ped.numero,''), p_pedido_id, now())
    RETURNING id INTO v_rec_id;
    v_rec_ids := array_append(v_rec_ids, v_rec_id); v_n_parc := 1;
  END IF;

  UPDATE erp_pedidos SET status='faturado', data_faturamento=now(), titulos_gerados=true, cmv=v_cmv, updated_at=now()
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'numero',v_ped.numero,
    'cmv',v_cmv,'qtd_movimentos_estoque',v_n_mov,'qtd_titulos_receber',v_n_parc,
    'receber_ids',to_jsonb(v_rec_ids),'movimentos',v_movs);
END;
$function$;

-- ── 2) BACKFILL idempotente das parcelas órfãs (match por TOKEN EXATO, só 1 pedido, só pedido_id NULL) ─
WITH candidatas AS (
  SELECT r.id AS receber_id,
         (SELECT array_agg(p.id) FROM public.erp_pedidos p
            WHERE p.company_id = r.company_id
              AND (r.descricao = 'Pedido ' || p.numero
                   OR r.descricao LIKE 'Pedido ' || p.numero || ' - parcela %')) AS pedido_ids
    FROM public.erp_receber r
   WHERE r.pedido_id IS NULL AND r.deleted_at IS NULL AND r.descricao LIKE 'Pedido %'
)
UPDATE public.erp_receber r
   SET pedido_id = c.pedido_ids[1]
  FROM candidatas c
 WHERE r.id = c.receber_id
   AND array_length(c.pedido_ids, 1) = 1;   -- casamento único; ambíguo/sem-pedido não é tocado
