-- 🔒 Segurança · lote 1 · S1 Financeiro e banco (CEO 01/10: "as que GRAVAM, em PRs de ~10, na ordem de risco").
-- Funções SECURITY DEFINER (rodam como dono, pulam a RLS) que gravavam em QUALQUER empresa pelo id recebido: um cliente
-- logado podia gerar títulos de compra, trocar parcelas de pedido, propor preço em cotação, vincular categoria de DRE,
-- registrar/disparar conexão bancária (Pluggy) e marcar fechamento BPO de outra empresa.
-- Correção: antes de gravar, a empresa do registro tem de ser do usuário — mesma guarda das PR A2/A2b e da #1953:
--   · sem usuário (serviço, cron, webhook com service_role) passa;
--   · equipe PS (is_admin) passa;
--   · empresa que não é do usuário → erro 42501 "Sem acesso a esta empresa".
-- A empresa vem SEMPRE do próprio registro (nunca de parâmetro do cliente). Autoria (gerado_por/enviado_por/usuario_id)
-- passa a vir da sessão; o parâmetro só vale sem sessão (serviço). Resto de cada corpo igual ao de produção em 01/10.
-- Fora desta migration (conferido no código de produção): fn_remessa_cancelar e fn_remessa_remover_item já conferem o
-- acesso (fn__remessa_pode) e fn_veic_custo_gerar_pagar já confere (fn_veic_acesso) — aqui só a autoria desta última.

-- ── guarda comum ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__guarda_empresa(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN; END IF;
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn__guarda_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__guarda_empresa(uuid) TO authenticated, service_role;

-- ── 1) fn_compra_gerar_titulos ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compra_gerar_titulos(p_compra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra record; v_n int; v_valor_parcela numeric; v_data_venc date;
  i int; v_valor_atual numeric; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
BEGIN
  SELECT * INTO v_compra FROM erp_compras WHERE id = p_compra_id;
  IF v_compra IS NULL THEN RAISE EXCEPTION 'Compra nao encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_compra.company_id);
  IF COALESCE(v_compra.titulos_gerados, false) THEN RAISE EXCEPTION 'Titulos ja gerados pra esta compra'; END IF;
  IF COALESCE(v_compra.total, 0) <= 0 THEN RAISE EXCEPTION 'Compra sem valor total'; END IF;

  v_n := COALESCE(NULLIF(v_compra.parcelas, 0), 1);
  v_data_venc := COALESCE(v_compra.primeiro_vencimento, CURRENT_DATE);
  v_valor_parcela := ROUND(v_compra.total / v_n, 2);

  FOR i IN 1..v_n LOOP
    v_valor_atual := CASE WHEN i = v_n THEN v_compra.total - (v_valor_parcela * (v_n - 1))
                          ELSE v_valor_parcela END;
    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, descricao, categoria,
      valor, data_emissao, data_vencimento, status, forma_pagamento,
      numero_documento, numero_nf, parcela, created_at
    ) VALUES (
      v_compra.company_id, v_compra.fornecedor_id, v_compra.fornecedor_nome,
      'Compra ' || COALESCE(v_compra.numero,''), 'Compras de mercadorias',
      v_valor_atual, COALESCE(v_compra.data_pedido, CURRENT_DATE),
      (v_data_venc + ((i-1) * INTERVAL '1 month'))::date, 'aberto',
      v_compra.forma_pagamento, v_compra.numero, v_compra.nf_numero,
      CASE WHEN v_n > 1 THEN i || '/' || v_n ELSE NULL END, now()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE erp_compras SET titulos_gerados = true, updated_at = now() WHERE id = p_compra_id;

  RETURN jsonb_build_object('ok', true, 'compra_id', p_compra_id,
    'qtd_parcelas', v_n, 'valor_total', v_compra.total, 'ids', to_jsonb(v_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_compra_gerar_titulos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_compra_gerar_titulos(uuid) TO authenticated, service_role;

-- ── 2) fn_pedido_salvar_parcelas ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_salvar_parcelas(p_pedido_id uuid, p_parcelas jsonb)
 RETURNS SETOF erp_pedidos_parcelas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_total numeric(14,2); v_soma numeric(14,2);
BEGIN
  SELECT company_id, total INTO v_company, v_total FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
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
END $function$;
REVOKE ALL ON FUNCTION public.fn_pedido_salvar_parcelas(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_salvar_parcelas(uuid, jsonb) TO authenticated, service_role;

-- ── 3) fn_cotacao_proposta_salvar ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cotacao_proposta_salvar(p_cotacao_fornecedor_id uuid, p_cotacao_item_id uuid, p_preco_unitario numeric, p_desconto_percentual numeric DEFAULT 0, p_disponivel boolean DEFAULT true, p_observacoes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cf record; v_item record;
  v_qtd numeric; v_subtotal numeric;
  v_prop_id uuid; v_fornec_total numeric; v_cot_status text;
BEGIN
  SELECT * INTO v_cf FROM erp_cotacoes_fornecedores WHERE id = p_cotacao_fornecedor_id;
  IF v_cf IS NULL THEN
    RAISE EXCEPTION 'Fornecedor da cotacao nao encontrado';
  END IF;
  PERFORM public.fn__guarda_empresa(v_cf.company_id);

  SELECT * INTO v_item FROM erp_cotacoes_itens
    WHERE id = p_cotacao_item_id AND cotacao_id = v_cf.cotacao_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Item nao pertence a cotacao deste fornecedor';
  END IF;
  v_qtd := COALESCE(v_item.quantidade, 0);

  v_subtotal := ROUND(COALESCE(p_preco_unitario,0) * v_qtd
                      * (1 - COALESCE(p_desconto_percentual,0)/100.0), 2);

  INSERT INTO erp_cotacoes_propostas (
    cotacao_fornecedor_id, cotacao_item_id, company_id,
    preco_unitario, desconto_percentual, subtotal, disponivel, observacoes,
    created_at, updated_at)
  VALUES (
    p_cotacao_fornecedor_id, p_cotacao_item_id, v_cf.company_id,
    p_preco_unitario, COALESCE(p_desconto_percentual,0), v_subtotal,
    COALESCE(p_disponivel,true), p_observacoes, NOW(), NOW())
  ON CONFLICT (cotacao_fornecedor_id, cotacao_item_id)
  DO UPDATE SET
    preco_unitario     = EXCLUDED.preco_unitario,
    desconto_percentual= EXCLUDED.desconto_percentual,
    subtotal           = EXCLUDED.subtotal,
    disponivel         = EXCLUDED.disponivel,
    observacoes        = EXCLUDED.observacoes,
    updated_at         = NOW()
  RETURNING id INTO v_prop_id;

  SELECT COALESCE(SUM(subtotal),0) INTO v_fornec_total
    FROM erp_cotacoes_propostas
    WHERE cotacao_fornecedor_id = p_cotacao_fornecedor_id AND disponivel = true;

  UPDATE erp_cotacoes_fornecedores
    SET subtotal = v_fornec_total,
        total    = v_fornec_total,
        status   = CASE WHEN status IN ('convidado','visualizou') THEN 'respondeu' ELSE status END,
        data_resposta = COALESCE(data_resposta, NOW()),
        updated_at = NOW()
    WHERE id = p_cotacao_fornecedor_id;

  SELECT status INTO v_cot_status FROM erp_cotacoes WHERE id = v_cf.cotacao_id;
  IF v_cot_status IN ('rascunho','enviada') THEN
    UPDATE erp_cotacoes SET status='em_resposta', updated_at=NOW() WHERE id=v_cf.cotacao_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'proposta_id', v_prop_id,
    'subtotal', v_subtotal, 'fornecedor_total', v_fornec_total, 'quantidade', v_qtd);
END $function$;
REVOKE ALL ON FUNCTION public.fn_cotacao_proposta_salvar(uuid, uuid, numeric, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cotacao_proposta_salvar(uuid, uuid, numeric, numeric, boolean, text) TO authenticated, service_role;

-- ── 4) fn_dre_vincular_categoria_linha ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dre_vincular_categoria_linha(p_ldn_id uuid, p_categoria_codigo text, p_tipo text DEFAULT 'receita'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT empresa_id INTO v_company_id FROM linhas_negocio WHERE id = p_ldn_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'LDN nao encontrada');
  END IF;
  PERFORM public.fn__guarda_empresa(v_company_id);

  INSERT INTO erp_dre_divisoes (
    id, company_id, divisao, categoria_codigo, tipo, status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_company_id,
    p_ldn_id::text,
    p_categoria_codigo,
    p_tipo,
    'ativo',
    NOW(), NOW()
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sucesso', true,
    'ldn_id', p_ldn_id,
    'categoria_codigo', p_categoria_codigo,
    'tipo', p_tipo
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_dre_vincular_categoria_linha(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dre_vincular_categoria_linha(uuid, text, text) TO authenticated, service_role;

-- ── 5) sp_pluggy_register_item (Wealth: mesma regra da RLS de wealth_pluggy_items) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.sp_pluggy_register_item(p_client_id uuid, p_consent_id uuid, p_pluggy_item_id text, p_connector_id integer, p_connector_name text, p_connector_type text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_item_id    uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM wealth_clients WHERE id = p_client_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Client nao encontrado: %', p_client_id;
  END IF;
  -- 01/10: só quem pode ver o cliente Wealth (admin Wealth ou consultor/operador dele); sem sessão = serviço passa
  IF auth.uid() IS NOT NULL
     AND NOT (public.fn_wealth_user_pode_ver_tudo() OR public.fn_wealth_user_eh_operador(p_client_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wealth_pluggy_consents
    WHERE id = p_consent_id AND client_id = p_client_id AND revogado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Consent invalido ou revogado: %', p_consent_id;
  END IF;
  INSERT INTO wealth_pluggy_items (
    client_id, company_id, consent_id,
    pluggy_item_id, connector_id, connector_name, connector_type,
    status
  ) VALUES (
    p_client_id, v_company_id, p_consent_id,
    p_pluggy_item_id, p_connector_id, p_connector_name, p_connector_type,
    'LOGIN_IN_PROGRESS'
  )
  ON CONFLICT (pluggy_item_id) DO UPDATE
    SET status = 'LOGIN_IN_PROGRESS',
        consent_id = EXCLUDED.consent_id,
        ultimo_erro_msg = NULL,
        ultimo_erro_em = NULL,
        updated_at = now()
  RETURNING id INTO v_item_id;
  RETURN v_item_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.sp_pluggy_register_item(uuid, uuid, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pluggy_register_item(uuid, uuid, text, integer, text, text) TO authenticated, service_role;

-- ── 6) sp_pluggy_dispatch_sync (webhook/cron rodam sem sessão e passam) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sp_pluggy_dispatch_sync(p_item_id uuid, p_origem text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_item            record;
  v_creds           jsonb;
  v_sync_log_id     uuid;
  v_request_id      bigint;
BEGIN
  IF p_origem NOT IN ('cron','webhook','manual_consultor','cliente_refresh','item_created') THEN
    RAISE EXCEPTION 'Origem invalida: %', p_origem;
  END IF;
  SELECT id, client_id, company_id, pluggy_item_id, ultimo_sync_em, status
  INTO v_item FROM wealth_pluggy_items WHERE id = p_item_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Item nao encontrado: %', p_item_id;
  END IF;
  -- 01/10: só quem pode ver o cliente Wealth do item; sem sessão (cron/webhook) passa
  IF auth.uid() IS NOT NULL
     AND NOT (public.fn_wealth_user_pode_ver_tudo() OR public.fn_wealth_user_eh_operador(v_item.client_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_item.status IN ('REVOKED', 'DELETED') THEN
    RAISE EXCEPTION 'Item revogado/deletado: %', p_item_id;
  END IF;
  v_creds := fn_pluggy_get_credentials();
  IF v_creds ? 'error' THEN
    RAISE EXCEPTION 'Credentials missing: %', v_creds->>'error';
  END IF;
  INSERT INTO wealth_pluggy_sync_log (
    item_id, client_id, company_id, origem, status
  ) VALUES (
    v_item.id, v_item.client_id, v_item.company_id, p_origem, 'parcial'
  ) RETURNING id INTO v_sync_log_id;
  SELECT net.http_post(
    url := 'https://api.pluggy.ai/auth',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'clientId', v_creds->>'client_id',
      'clientSecret', v_creds->>'client_secret'
    ),
    timeout_milliseconds := 10000
  ) INTO v_request_id;
  INSERT INTO wealth_pluggy_sync_requests (
    sync_log_id, item_id, client_id, tipo, request_id
  ) VALUES (
    v_sync_log_id, v_item.id, v_item.client_id, 'auth', v_request_id
  );
  UPDATE wealth_pluggy_items SET status = 'UPDATING', updated_at = now() WHERE id = v_item.id;
  RETURN v_sync_log_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.sp_pluggy_dispatch_sync(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pluggy_dispatch_sync(uuid, text) TO authenticated, service_role;

-- ── 7) fn_bpo_fechamento_executar_lote (roda para TODAS as empresas BPO → só equipe PS ou serviço) ────────────────
CREATE OR REPLACE FUNCTION public.fn_bpo_fechamento_executar_lote(p_mes_ref date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company record;
  v_validacao jsonb;
  v_dados jsonb;
  v_pronto boolean;
  v_status text;
  v_total int := 0;
  v_prontos int := 0;
  v_bloqueados int := 0;
  v_link_token text;
BEGIN
  -- 01/10: o lote passa por todas as empresas com contrato BPO — só a equipe PS (ou o serviço, sem sessão)
  IF auth.uid() IS NOT NULL AND NOT (public.is_admin() OR EXISTS (
       SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'Sem acesso: o fechamento em lote é da equipe PS' USING ERRCODE = '42501';
  END IF;

  FOR v_company IN
    SELECT c.id AS company_id, COALESCE(c.nome_fantasia, c.razao_social) AS nome
    FROM companies c
    JOIN bpo_contratos bc ON bc.company_id = c.id AND bc.ativo = true
    WHERE c.is_active = true
  LOOP
    v_total := v_total + 1;

    -- Validar
    v_validacao := fn_bpo_fechamento_validar(v_company.company_id, p_mes_ref);
    v_pronto := (v_validacao->>'pronto')::boolean;

    IF v_pronto THEN
      v_prontos := v_prontos + 1;
      v_dados := fn_bpo_fechamento_gerar_dados(v_company.company_id, p_mes_ref);
      v_status := 'gerado';
    ELSE
      v_bloqueados := v_bloqueados + 1;
      v_dados := NULL;
      v_status := 'bloqueado';
    END IF;

    -- Token unico do portal (16 caracteres)
    v_link_token := encode(gen_random_bytes(12), 'base64');
    v_link_token := replace(replace(v_link_token, '/', '-'), '+', '_');

    -- Upsert no fechamento (autoria da sessão; o parâmetro só vale sem sessão)
    INSERT INTO bpo_fechamento_mensal (
      company_id, mes_referencia, status,
      pronto_para_fechar, gaps_atuais, validado_em,
      dados_consolidados, pdf_gerado_em,
      link_portal, gerado_por
    )
    VALUES (
      v_company.company_id, p_mes_ref, v_status,
      v_pronto, v_validacao->'gaps', now(),
      v_dados, CASE WHEN v_pronto THEN now() ELSE NULL END,
      v_link_token, COALESCE(auth.uid(), p_user_id)
    )
    ON CONFLICT (company_id, mes_referencia) DO UPDATE SET
      status = CASE
        WHEN bpo_fechamento_mensal.status IN ('enviado','cancelado')
        THEN bpo_fechamento_mensal.status  -- Nao sobrescreve enviado/cancelado
        ELSE EXCLUDED.status END,
      pronto_para_fechar = EXCLUDED.pronto_para_fechar,
      gaps_atuais = EXCLUDED.gaps_atuais,
      validado_em = now(),
      dados_consolidados = CASE
        WHEN bpo_fechamento_mensal.status IN ('enviado','cancelado')
        THEN bpo_fechamento_mensal.dados_consolidados
        ELSE EXCLUDED.dados_consolidados END,
      pdf_gerado_em = CASE
        WHEN bpo_fechamento_mensal.status IN ('enviado','cancelado')
        THEN bpo_fechamento_mensal.pdf_gerado_em
        ELSE EXCLUDED.pdf_gerado_em END,
      updated_at = now();
  END LOOP;

  RETURN jsonb_build_object(
    'mes_referencia', p_mes_ref,
    'total_empresas', v_total,
    'prontos_gerados', v_prontos,
    'bloqueados', v_bloqueados,
    'executado_em', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_bpo_fechamento_executar_lote(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bpo_fechamento_executar_lote(date, uuid) TO authenticated, service_role;

-- ── 8) fn_bpo_fechamento_marcar_enviado ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bpo_fechamento_marcar_enviado(p_fechamento_id uuid, p_canal text, p_destinatario text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_status_atual text; v_company uuid;
BEGIN
  SELECT status, company_id INTO v_status_atual, v_company FROM bpo_fechamento_mensal WHERE id = p_fechamento_id;

  IF v_status_atual IS NULL THEN
    RAISE EXCEPTION 'Fechamento nao encontrado';
  END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  IF p_canal = 'email' THEN
    UPDATE bpo_fechamento_mensal
    SET enviado_email = true, enviado_email_em = now(), enviado_email_para = p_destinatario,
        status = CASE WHEN status='gerado' THEN 'enviado' ELSE status END,
        enviado_por = COALESCE(enviado_por, auth.uid(), p_user_id),
        updated_at = now()
    WHERE id = p_fechamento_id;
  ELSIF p_canal = 'whatsapp' THEN
    UPDATE bpo_fechamento_mensal
    SET enviado_whatsapp = true, enviado_whatsapp_em = now(), enviado_whatsapp_para = p_destinatario,
        status = CASE WHEN status='gerado' THEN 'enviado' ELSE status END,
        enviado_por = COALESCE(enviado_por, auth.uid(), p_user_id),
        updated_at = now()
    WHERE id = p_fechamento_id;
  ELSIF p_canal = 'portal' THEN
    UPDATE bpo_fechamento_mensal
    SET link_portal_acessado_em = now(),
        updated_at = now()
    WHERE id = p_fechamento_id;
  ELSE
    RAISE EXCEPTION 'Canal invalido: %. Use email, whatsapp ou portal', p_canal;
  END IF;

  RETURN jsonb_build_object('success', true, 'canal', p_canal);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_bpo_fechamento_marcar_enviado(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bpo_fechamento_marcar_enviado(uuid, text, text, uuid) TO authenticated, service_role;

-- ── 9) fn_veic_custo_gerar_pagar (acesso já conferido por fn_veic_acesso — só a autoria do evento) ───────────────
CREATE OR REPLACE FUNCTION public.fn_veic_custo_gerar_pagar(p_custo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_comp uuid; v_modelo text; v_placa text; v_venc date;
  v_forn_id uuid; v_forn_nome text; v_pagar_id uuid;
BEGIN
  SELECT id, company_id, veiculo_id, categoria, valor, descricao, data_custo,
         fornecedor_id, fornecedor_nome, pagar_id, deleted_at
    INTO v_c FROM veic_custo WHERE id = p_custo_id;
  IF v_c.id IS NULL OR v_c.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'custo_nao_encontrado'); END IF;

  v_comp := public.fn_veic_acesso(v_c.veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- idempotencia: custo ja tem titulo
  IF v_c.pagar_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'pagar_id', v_c.pagar_id, 'custo_id', p_custo_id); END IF;

  -- vencimento e obrigatorio para o titulo (mesma regra de fn_veic_custo_salvar)
  BEGIN v_venc := NULLIF(btrim(p_dados->>'vencimento'),'')::date; EXCEPTION WHEN others THEN v_venc := NULL; END;
  IF v_venc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo', 'campo', 'vencimento'); END IF;

  -- fornecedor: usa o informado; senao herda o do custo
  v_forn_id   := COALESCE(NULLIF(p_dados->>'fornecedor_id','')::uuid, v_c.fornecedor_id);
  v_forn_nome := COALESCE(NULLIF(btrim(p_dados->>'fornecedor_nome'),''), v_c.fornecedor_nome);

  SELECT modelo, placa INTO v_modelo, v_placa FROM veic_veiculo WHERE id = v_c.veiculo_id;

  INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                         fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
  VALUES (v_c.company_id, v_c.valor,
          COALESCE(v_c.categoria,'custo') || ' — ' || COALESCE(v_modelo,'') || ' ' || COALESCE(v_placa,'')
            || COALESCE(' — ' || NULLIF(btrim(v_c.descricao),''), ''),
          v_venc, COALESCE(v_c.data_custo, CURRENT_DATE), v_c.categoria,
          v_forn_id, v_forn_nome, 'revenda_veiculos', v_c.id::text)
  RETURNING id INTO v_pagar_id;

  UPDATE veic_custo
     SET pagar_id = v_pagar_id,
         fornecedor_id = v_forn_id,
         fornecedor_nome = v_forn_nome
   WHERE id = p_custo_id;

  -- autoria do evento: a sessão (o parâmetro só vale sem sessão)
  INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, v_c.veiculo_id, 'pagar', 'LANCOU conta a pagar do custo (' || COALESCE(v_c.categoria,'custo') || ') R$ ' || v_c.valor::text, COALESCE(auth.uid(), p_user),
          jsonb_build_object('custo_id', p_custo_id, 'pagar_id', v_pagar_id, 'vencimento', v_venc));

  RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'pagar_id', v_pagar_id, 'custo_id', p_custo_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_veic_custo_gerar_pagar(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_gerar_pagar(uuid, jsonb, uuid) TO authenticated, service_role;
