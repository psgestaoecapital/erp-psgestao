-- ============================================================
-- Faturamento #18 v2 · ETAPA 3 — passo 2/5: a PREVISÃO nasce no pedido (automática, D-3)
-- ============================================================
-- SPEC docs/SPEC_faturamento_etapa3_previsto_efetivacao.md. Depende do passo 1 (colunas pedido_id/
-- pedido_parcela_id/nfse_id/motivo_perda/cancelado_em + estado faturamento_parcial) — JÁ em produção.
--
-- Regra (§1 + D-3): ao salvar as parcelas de um pedido, cria/reconcilia os títulos PREVISTOS —
-- status='previsto', data_emissao/pagamento/competencia NULAS (é o que os mantém fora de DRE/caixa/
-- competência) e data_vencimento setada. Zero fiscal. Sem estoque/CMV (isso é o passo 3).
--
-- Cuidados do CEO:
--  #1 EDIÇÃO: parcela já EFETIVADA (título não-previsto, nota emitida) NÃO pode ser alterada nem removida.
--     fn_pedido_salvar_parcelas bloqueia isso explicitamente. Parcelas ainda previstas ajustam livremente.
--  #2 RASCUNHO: não existe estado de rascunho de pedido hoje (status: aberto/em_separacao/expedido/
--     entregue/faturamento_parcial/faturado/cancelado) — o pedido já é o compromisso. Mesmo assim, previsão
--     NUNCA é gerada para pedido 'cancelado' nem 'faturado'. Se um dia entrar estado de rascunho, é só
--     acrescentá-lo à guarda de fn_pedido_gerar_previsao.
--
-- Amarração estável: fn_pedido_salvar_parcelas passa a RECONCILIAR por (pedido_id, numero) — chave única
-- que já existe — em vez de apagar-e-recriar. Assim o id da parcela é PRESERVADO e as previsões (e, no
-- passo 3, as notas) continuam amarradas. Respeita os gatilhos de erp_receber: sem DELETE físico (usa
-- soft-delete por deleted_at, RD-30) e o antidup (fn_titulo_antidup, só em INSERT) é liberado nesta
-- transação por set_config local, pois é regeneração controlada.

-- ------------------------------------------------------------
-- (1) fn_pedido_gerar_previsao — DONO único das previsões de um pedido (idempotente).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pedido_gerar_previsao(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ped record; v_tot int; v_upd int := 0; v_ins int := 0; v_del int := 0;
BEGIN
  SELECT * INTO v_ped FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'pedido nao encontrado'); END IF;

  -- #2: só pedido VIVO gera previsão. Cancelado/faturado nunca. (Não há estado de rascunho hoje.)
  IF v_ped.status IN ('cancelado','faturado') THEN
    RETURN jsonb_build_object('ok', true, 'ignorado_status', v_ped.status);
  END IF;

  SELECT count(*) INTO v_tot FROM public.erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;

  -- regeneração controlada: libera o antidup só nesta transação (INSERT de previsão conhecida)
  PERFORM set_config('app.forcar_titulo_dup', '1', true);

  IF v_tot > 0 THEN
    -- (a) soft-delete das previsões cuja parcela sumiu (RD-30: nunca DELETE físico em erp_receber)
    UPDATE public.erp_receber r SET deleted_at = now(), updated_at = now()
     WHERE r.pedido_id = p_pedido_id AND r.status = 'previsto' AND r.deleted_at IS NULL
       AND (r.pedido_parcela_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM public.erp_pedidos_parcelas pp WHERE pp.id = r.pedido_parcela_id));
    GET DIAGNOSTICS v_del = ROW_COUNT;

    -- (b) atualiza as previsões existentes conforme a parcela atual (por pedido_parcela_id — id estável)
    UPDATE public.erp_receber r SET
        valor = pp.valor, data_vencimento = pp.vencimento,
        forma_pagamento = pp.forma_pagamento, conta_bancaria_id = pp.conta_bancaria_id,
        cliente_id = v_ped.cliente_id, cliente_nome = v_ped.cliente_nome,
        numero_documento = COALESCE(v_ped.numero,'') || ' ' || pp.numero || '/' || v_tot,
        descricao = 'Pedido ' || COALESCE(v_ped.numero,'') || ' - parcela ' || pp.numero || '/' || v_tot || ' (previsão)',
        updated_at = now()
      FROM public.erp_pedidos_parcelas pp
     WHERE pp.pedido_id = p_pedido_id AND r.pedido_parcela_id = pp.id
       AND r.status = 'previsto' AND r.deleted_at IS NULL;
    GET DIAGNOSTICS v_upd = ROW_COUNT;

    -- (c) cria previsão para a parcela que ainda não tem
    INSERT INTO public.erp_receber (company_id, cliente_id, cliente_nome, valor, data_vencimento,
        data_emissao, data_pagamento, data_competencia, status, categoria, numero_documento, descricao,
        forma_pagamento, conta_bancaria_id, pedido_id, pedido_parcela_id, created_at)
    SELECT v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, pp.valor, pp.vencimento,
        NULL, NULL, NULL, 'previsto', 'Receita de vendas (previsão)',
        COALESCE(v_ped.numero,'') || ' ' || pp.numero || '/' || v_tot,
        'Pedido ' || COALESCE(v_ped.numero,'') || ' - parcela ' || pp.numero || '/' || v_tot || ' (previsão)',
        pp.forma_pagamento, pp.conta_bancaria_id, p_pedido_id, pp.id, now()
    FROM public.erp_pedidos_parcelas pp
    WHERE pp.pedido_id = p_pedido_id
      AND NOT EXISTS (SELECT 1 FROM public.erp_receber r
                      WHERE r.pedido_parcela_id = pp.id AND r.status = 'previsto' AND r.deleted_at IS NULL);
    GET DIAGNOSTICS v_ins = ROW_COUNT;

  ELSIF COALESCE(v_ped.total,0) > 0 THEN
    -- à vista (sem parcelas): 1 previsão pelo total, amarrada ao pedido (parcela nula)
    IF EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.pedido_id = p_pedido_id
                 AND r.pedido_parcela_id IS NULL AND r.status='previsto' AND r.deleted_at IS NULL) THEN
      UPDATE public.erp_receber r SET
          valor = v_ped.total, data_vencimento = COALESCE(v_ped.primeiro_vencimento, v_ped.data_pedido, CURRENT_DATE),
          cliente_id = v_ped.cliente_id, cliente_nome = v_ped.cliente_nome,
          descricao = 'Pedido ' || COALESCE(v_ped.numero,'') || ' (previsão à vista)', updated_at = now()
        WHERE r.pedido_id = p_pedido_id AND r.pedido_parcela_id IS NULL
          AND r.status='previsto' AND r.deleted_at IS NULL;
      GET DIAGNOSTICS v_upd = ROW_COUNT;
    ELSE
      INSERT INTO public.erp_receber (company_id, cliente_id, cliente_nome, valor, data_vencimento,
          data_emissao, data_pagamento, data_competencia, status, categoria, numero_documento, descricao,
          pedido_id, pedido_parcela_id, created_at)
      VALUES (v_ped.company_id, v_ped.cliente_id, v_ped.cliente_nome, v_ped.total,
          COALESCE(v_ped.primeiro_vencimento, v_ped.data_pedido, CURRENT_DATE), NULL, NULL, NULL,
          'previsto', 'Receita de vendas (previsão)', v_ped.numero,
          'Pedido ' || COALESCE(v_ped.numero,'') || ' (previsão à vista)', p_pedido_id, NULL, now());
      GET DIAGNOSTICS v_ins = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'total_parcelas', v_tot,
    'previstos_novos', v_ins, 'previstos_atualizados', v_upd, 'previstos_removidos', v_del);
END $fn$;

GRANT EXECUTE ON FUNCTION public.fn_pedido_gerar_previsao(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- (2) fn_pedido_salvar_parcelas — RECONCILIA por (pedido_id,numero) (ids estáveis) + guarda de efetivada
--     (#1) + dispara a previsão automática (D-3). Assinatura preservada (o front não muda).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pedido_salvar_parcelas(p_pedido_id uuid, p_parcelas jsonb)
RETURNS SETOF erp_pedidos_parcelas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid; v_total numeric(14,2); v_soma numeric(14,2);
BEGIN
  SELECT company_id, total INTO v_company, v_total FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  SELECT COALESCE(SUM((x->>'valor')::numeric),0) INTO v_soma FROM jsonb_array_elements(p_parcelas) x;
  IF ROUND(v_soma,2) <> ROUND(v_total,2) THEN
    RAISE EXCEPTION 'Soma das parcelas (R$ %) difere do total do pedido (R$ %)', v_soma, v_total;
  END IF;

  -- #1: parcela já EFETIVADA (título não-previsto) não pode mudar nem sair. Bloqueia se alguma efetivada
  -- não vier no conjunto com o MESMO numero + valor + vencimento.
  IF EXISTS (
    SELECT 1 FROM public.erp_pedidos_parcelas pp
    JOIN public.erp_receber r ON r.pedido_parcela_id = pp.id AND r.deleted_at IS NULL AND r.status <> 'previsto'
    WHERE pp.pedido_id = p_pedido_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_parcelas) x
                      WHERE (x->>'numero')::int = pp.numero
                        AND ROUND((x->>'valor')::numeric,2) = ROUND(pp.valor,2)
                        AND (x->>'vencimento')::date = pp.vencimento)
  ) THEN
    RAISE EXCEPTION 'Parcela já faturada (nota emitida) não pode ser alterada ou removida. Edite apenas as parcelas ainda previstas.';
  END IF;

  -- remove parcelas que sumiram (só as não-efetivadas; as efetivadas já foram barradas acima).
  -- erp_pedidos_parcelas não tem trava de delete físico (só erp_receber tem).
  DELETE FROM public.erp_pedidos_parcelas
   WHERE pedido_id = p_pedido_id
     AND numero NOT IN (SELECT (x->>'numero')::int FROM jsonb_array_elements(p_parcelas) x);

  -- upsert por (pedido_id, numero) — PRESERVA os ids (chave única já existente)
  INSERT INTO public.erp_pedidos_parcelas
    (company_id, pedido_id, numero, valor, vencimento, forma_pagamento, gerar_boleto, observacoes, conta_bancaria_id)
  SELECT v_company, p_pedido_id, (x->>'numero')::int, (x->>'valor')::numeric, (x->>'vencimento')::date,
         x->>'forma_pagamento', COALESCE((x->>'gerar_boleto')::boolean,false), x->>'observacoes',
         NULLIF(x->>'conta_bancaria_id','')::uuid
  FROM jsonb_array_elements(p_parcelas) x
  ON CONFLICT (pedido_id, numero) DO UPDATE SET
    valor = EXCLUDED.valor, vencimento = EXCLUDED.vencimento, forma_pagamento = EXCLUDED.forma_pagamento,
    gerar_boleto = EXCLUDED.gerar_boleto, observacoes = EXCLUDED.observacoes,
    conta_bancaria_id = EXCLUDED.conta_bancaria_id, updated_at = now();

  UPDATE public.erp_pedidos SET
    parcelas = (SELECT COUNT(*) FROM public.erp_pedidos_parcelas WHERE pedido_id = p_pedido_id),
    primeiro_vencimento = (SELECT MIN(vencimento) FROM public.erp_pedidos_parcelas WHERE pedido_id = p_pedido_id),
    updated_at = now()
  WHERE id = p_pedido_id;

  -- D-3: previsão automática (dono único das previsões)
  PERFORM public.fn_pedido_gerar_previsao(p_pedido_id);

  RETURN QUERY SELECT * FROM public.erp_pedidos_parcelas WHERE pedido_id = p_pedido_id ORDER BY numero;
END $fn$;
