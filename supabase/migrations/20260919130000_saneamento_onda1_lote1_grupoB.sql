-- 🚨 Saneamento Onda 1 · resto do Lote 1 (Grupo B: row-resolved / INT / trigger) + straggler do Grupo A.
-- Inventário #1560. Contexto 6b5cad70. RDs 25·38·52·65·34-V5.
--
-- Row-resolved (não têm p_company_id; a empresa vem da LINHA/id) → guarda padrão resolvendo a empresa
-- pelo registro. Trigger → ACL-only (só a trigger invoca; REVOKE anon/authenticated/public). _impl já
-- fechado (sem anon/authenticated) → só REVOKE defensivo. Corpos reproduzidos fiéis; só a guarda.
--
-- fn_import_financeiro_v3 entra aqui porque o commit que a adicionava foi enviado ao branch do #1563
-- DEPOIS do merge (ficou fora da main); a guarda já está em produção (execute_sql), mas sem migration
-- mergeada → esta migration fecha a lacuna do ledger (RD-52). Guarda pela empresa do parâmetro +
-- blindagem do override company_id por linha.

-- ── fn_pedido_cancelar (empresa vem de erp_pedidos) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_cancelar(p_pedido_id uuid, p_motivo_perda_id uuid, p_motivo_texto text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ped record; v_exige boolean; v_n_perda int; v_tem_efet boolean; v_novo_status text;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_ped FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_ped.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF v_ped.status IN ('cancelado','cancelado_parcial') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido já cancelado'); END IF;

  IF p_motivo_perda_id IS NULL THEN RAISE EXCEPTION 'Escolha o motivo da perda.'; END IF;
  SELECT exige_descricao INTO v_exige FROM public.erp_motivo_perda
    WHERE id = p_motivo_perda_id AND company_id = v_ped.company_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Motivo de perda inválido para esta empresa.'; END IF;
  IF v_exige AND COALESCE(btrim(p_motivo_texto),'') = '' THEN
    RAISE EXCEPTION 'Este motivo exige uma descrição — diga o que aconteceu.'; END IF;

  UPDATE public.erp_receber
     SET status = 'cancelado', motivo_perda_id = p_motivo_perda_id,
         motivo_perda = CASE WHEN v_exige THEN btrim(p_motivo_texto) ELSE motivo_perda END,
         cancelado_em = now(), updated_at = now()
   WHERE pedido_id = p_pedido_id AND status = 'previsto' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n_perda = ROW_COUNT;

  v_tem_efet := EXISTS (
    SELECT 1 FROM public.erp_receber
     WHERE pedido_id = p_pedido_id AND deleted_at IS NULL AND status NOT IN ('previsto','cancelado'));
  v_novo_status := CASE WHEN v_tem_efet THEN 'cancelado_parcial' ELSE 'cancelado' END;

  UPDATE public.erp_pedidos SET status = v_novo_status, updated_at = now() WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id, 'status', v_novo_status,
    'parcelas_perdidas', v_n_perda, 'tem_efetivadas', v_tem_efet);
END $function$;

-- ── fn_pedido_gerar_previsao (empresa vem de erp_pedidos) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_gerar_previsao(p_pedido_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ped record; v_tot int; v_upd int := 0; v_ins int := 0; v_del int := 0;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_ped FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'pedido nao encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_ped.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  IF v_ped.status IN ('cancelado','faturado') THEN
    RETURN jsonb_build_object('ok', true, 'ignorado_status', v_ped.status);
  END IF;

  SELECT count(*) INTO v_tot FROM public.erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;

  PERFORM set_config('app.forcar_titulo_dup', '1', true);

  IF v_tot > 0 THEN
    UPDATE public.erp_receber r SET deleted_at = now(), updated_at = now()
     WHERE r.pedido_id = p_pedido_id AND r.status = 'previsto' AND r.deleted_at IS NULL
       AND (r.pedido_parcela_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM public.erp_pedidos_parcelas pp WHERE pp.id = r.pedido_parcela_id));
    GET DIAGNOSTICS v_del = ROW_COUNT;

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
END $function$;

-- ── fn_pagar_recalcular_status (empresa vem de erp_pagar) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_recalcular_status(p_pagar_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_devido numeric; v_saldo numeric; v_company uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT company_id INTO v_company FROM erp_pagar WHERE id = p_pagar_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro','nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  UPDATE erp_pagar SET valor_pago = valor_pago WHERE id = p_pagar_id;  -- toca → dispara trg_status_pagar
  SELECT * INTO r FROM erp_pagar WHERE id = p_pagar_id;
  v_devido := COALESCE(r.valor,0) + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0);
  v_saldo  := round(v_devido - COALESCE(r.valor_pago,0), 2);
  RETURN jsonb_build_object('ok', true, 'devido', round(v_devido,2), 'pago', COALESCE(r.valor_pago,0),
    'saldo', v_saldo, 'status', r.status);
END $function$;

-- ── fn_recompute_baixa_titulo (empresa resolvida dinamicamente pela tabela/id) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_valor numeric; v_venc date; v_soma numeric; v_n int; v_dt date; v_status text;
        v_juros numeric; v_multa numeric; v_desc numeric; v_liquido numeric; v_company uuid;
        v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  IF p_tabela = 'erp_receber' THEN SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_id;
  ELSE SELECT company_id INTO v_company FROM public.erp_pagar WHERE id = p_id; END IF;
  IF v_company IS NULL THEN RETURN; END IF;  -- título inexistente: nada a fazer (comportamento atual)
  IF NOT (v_interno OR auth.role()='service_role' OR v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  SELECT COALESCE(SUM(valor),0), count(*), max(data_transacao) INTO v_soma, v_n, v_dt
    FROM public.conciliacao_movimento
   WHERE lancamento_tabela = p_tabela AND lancamento_id = p_id AND status = 'conciliado';
  IF p_tabela = 'erp_receber' THEN
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(multa,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_multa, v_desc FROM public.erp_receber WHERE id = p_id;
  ELSE
    SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(multa,0), COALESCE(desconto,0)
      INTO v_valor, v_venc, v_juros, v_multa, v_desc FROM public.erp_pagar WHERE id = p_id;
  END IF;
  IF v_valor IS NULL THEN RETURN; END IF;
  -- MESMA fórmula da trigger fn_trg_status_lancamento (fonte única do saldo · RD-52)
  v_liquido := round(v_valor + v_juros + v_multa - v_desc, 2);
  IF v_n >= 2 AND v_soma > v_liquido + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liquido,'FM999999990.00') USING ERRCODE = '23514';
  END IF;
  v_status := CASE WHEN v_soma <= 0 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
    WHEN v_soma + 0.01 >= v_liquido THEN 'pago' ELSE 'parcial' END;
  IF p_tabela = 'erp_receber' THEN
    UPDATE public.erp_receber SET valor_pago = v_soma, status = v_status,
      data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
      forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
      updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE public.erp_pagar SET valor_pago = v_soma, status = v_status,
      data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
      forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
      updated_at = now() WHERE id = p_id;
  END IF;
END $function$;

-- ── fn_import_financeiro_v3 (straggler do Grupo A — guarda + blindagem do override por linha) ──────
CREATE OR REPLACE FUNCTION public.fn_import_financeiro_v3(p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_importacao_id uuid; v_record jsonb;
  v_inseridos int := 0; v_duplicados int := 0; v_erros int := 0;
  v_lista_erros jsonb := '[]'::jsonb;
  v_company_id uuid; v_tipo text; v_status text;
  v_total int; v_idx int := 0; v_ref_id text; v_new_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_records) = 'object' AND p_records ? 'records' THEN
    p_records := p_records -> 'records';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RETURN jsonb_build_object('erro', 'payload_invalido',
      'detalhe', 'Esperado um array de registros (ou objeto {"records": [...]}).');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_records) r
    WHERE NULLIF(r->>'company_id','') IS NOT NULL
      AND (r->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  v_total := jsonb_array_length(p_records);
  INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado, registros_total, status, arquivo_nome, iniciado_em)
  VALUES (p_company_id, p_user_id, 'planilha_padrao', 'financeiro', v_total, 'processando', p_arquivo_nome, NOW())
  RETURNING id INTO v_importacao_id;

  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_company_id := COALESCE(NULLIF(v_record->>'company_id','')::uuid, p_company_id);
      v_tipo := LOWER(TRIM(v_record->>'tipo'));
      IF v_tipo NOT IN ('pagar','receber') THEN
        RAISE EXCEPTION 'tipo deve ser pagar ou receber (recebido: %)', v_record->>'tipo';
      END IF;
      IF (v_record->>'valor_documento') IS NULL OR (v_record->>'valor_documento')::numeric <= 0 THEN
        RAISE EXCEPTION 'valor_documento obrigatorio e > 0';
      END IF;
      IF NULLIF(v_record->>'data_vencimento','') IS NULL THEN
        RAISE EXCEPTION 'data_vencimento obrigatoria';
      END IF;

      v_status := CASE LOWER(TRIM(COALESCE(v_record->>'status','')))
        WHEN 'pago' THEN 'pago' WHEN 'quitado' THEN 'pago' WHEN 'liquidado' THEN 'pago'
        WHEN 'parcial' THEN 'parcial'
        WHEN 'vencido' THEN 'vencido' WHEN 'atrasado' THEN 'vencido'
        WHEN 'cancelado' THEN 'cancelado'
        ELSE 'aberto' END;

      v_ref_id := COALESCE(NULLIF(v_record->>'import_hash',''),
        md5(v_company_id::text||v_tipo||(v_record->>'valor_documento')||(v_record->>'data_vencimento')||COALESCE(v_record->>'descricao','')));

      IF v_tipo = 'pagar' THEN
        INSERT INTO erp_pagar (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, fornecedor_nome,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      ELSE
        INSERT INTO erp_receber (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, cliente_nome,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      END IF;

      IF v_new_id IS NULL THEN v_duplicados := v_duplicados + 1; ELSE v_inseridos := v_inseridos + 1; END IF;
      v_new_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      v_lista_erros := v_lista_erros || jsonb_build_object('linha', v_idx, 'descricao', v_record->>'descricao', 'erro', SQLERRM);
    END;
  END LOOP;

  UPDATE erp_importacoes SET registros_novos=v_inseridos, registros_atualizados=v_duplicados, registros_erro=v_erros,
    erros = CASE WHEN v_erros>0 THEN v_lista_erros ELSE NULL END,
    status = CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END,
    concluido_em = NOW()
  WHERE id = v_importacao_id;

  RETURN jsonb_build_object('importacao_id', v_importacao_id, 'total', v_total,
    'inseridos', v_inseridos, 'duplicados', v_duplicados, 'erros', v_erros, 'lista_erros', v_lista_erros,
    'status', CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END);
END;
$function$;

-- ── ACL ────────────────────────────────────────────────────────────────────────────────────────
-- Row-resolved: mantêm authenticated (guarda decide por empresa); tiram anon/public.
REVOKE EXECUTE ON FUNCTION public.fn_pedido_cancelar(uuid,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pedido_cancelar(uuid,uuid,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_pedido_gerar_previsao(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pedido_gerar_previsao(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_pagar_recalcular_status(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_recalcular_status(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_recompute_baixa_titulo(text,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_recompute_baixa_titulo(text,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_import_financeiro_v3(uuid,uuid,text,jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_import_financeiro_v3(uuid,uuid,text,jsonb) TO authenticated, service_role;

-- Trigger (só a trigger invoca; roda como dono) → ACL-only, sem anon/authenticated/public.
REVOKE EXECUTE ON FUNCTION public.fn_lancamento_para_caixa() FROM anon, authenticated, public;

-- _impl já fechado (sem anon/authenticated); REVOKE defensivo de public (idempotente).
REVOKE EXECUTE ON FUNCTION public._fn_odonto_plano_aprovar_financeiro_impl(uuid,text,uuid[],integer,numeric,date,text) FROM anon, public;
