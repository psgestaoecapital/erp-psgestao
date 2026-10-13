-- 🚨 Saneamento Onda 1 · Lote 1a — baixa/cancelamento/vencimento/liquidação de títulos (contexto 6b5cad70).
-- 4 funções SECURITY DEFINER estavam com EXECUTE p/ anon e sem guarda → mutação de título de QUALQUER
-- empresa SEM login. Inventário: issue #1560. RDs 25·38·65·34-V5.
-- Guarda padrão: sem JWT (interno/cron) OU service_role OU admin → passa; authenticated só na própria
-- empresa (senão 42501). REVOKE anon/public; GRANT authenticated, service_role. Assinatura/retorno
-- inalterados; corpo reproduzido fiel do que está em produção, só a guarda foi acrescentada.
-- Idempotente (CREATE OR REPLACE + REVOKE/GRANT).

-- ── batch_baixa_titulos ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_baixa_titulos(p_lancamento_ids uuid[], p_data_pagamento date, p_banco_conta_id uuid DEFAULT NULL::uuid, p_forma_pagamento character varying DEFAULT NULL::character varying, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_processados integer, total_sucesso integer, total_erros integer, mensagem text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_proc INT := 0; v_ok INT := 0; v_err INT := 0; v_id UUID; v_valor DECIMAL; v_found BOOL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  -- guarda: authenticated só pode mexer em títulos das SUAS empresas (interno/cron/service_role/admin passa).
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (
      SELECT 1 FROM erp_pagar   WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
      UNION ALL
      SELECT 1 FROM erp_receber WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
    ) THEN RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501'; END IF;
  END IF;

  FOREACH v_id IN ARRAY p_lancamento_ids LOOP
    v_proc := v_proc + 1; v_found := false;
    BEGIN
      UPDATE erp_pagar
         SET status='pago', data_pagamento=p_data_pagamento, valor_pago=valor,
             forma_pagamento=COALESCE(p_forma_pagamento, forma_pagamento),
             conta_bancaria=COALESCE(p_banco_conta_id::text, conta_bancaria), updated_at=NOW()
       WHERE id=v_id AND status<>'cancelado' RETURNING valor INTO v_valor;
      IF FOUND THEN
        v_found := true;
        IF p_banco_conta_id IS NOT NULL THEN
          UPDATE erp_banco_contas SET saldo_atual=saldo_atual - v_valor WHERE id=p_banco_conta_id;
        END IF;
      ELSE
        UPDATE erp_receber
           SET status='pago', data_pagamento=p_data_pagamento, valor_pago=valor,
               forma_pagamento=COALESCE(p_forma_pagamento, forma_pagamento),
               conta_bancaria=COALESCE(p_banco_conta_id::text, conta_bancaria), updated_at=NOW()
         WHERE id=v_id AND status<>'cancelado' RETURNING valor INTO v_valor;
        IF FOUND THEN
          v_found := true;
          IF p_banco_conta_id IS NOT NULL THEN
            UPDATE erp_banco_contas SET saldo_atual=saldo_atual + v_valor WHERE id=p_banco_conta_id;
          END IF;
        END IF;
      END IF;
      IF v_found THEN v_ok := v_ok + 1; ELSE v_err := v_err + 1; END IF;
    EXCEPTION WHEN OTHERS THEN v_err := v_err + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT v_proc, v_ok, v_err,
    format('%s titulos processados: %s sucesso, %s erros', v_proc, v_ok, v_err)::TEXT;
END;
$function$;

-- ── batch_cancelar_titulos ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_cancelar_titulos(p_lancamento_ids uuid[], p_motivo text DEFAULT 'Cancelamento em lote'::text, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_processados integer, total_sucesso integer, mensagem text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_n1 INT := 0; v_n2 INT := 0;
  v_obs TEXT := E'\n[CANCELADO] ' || p_motivo || ' em ' || TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI');
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (
      SELECT 1 FROM erp_pagar   WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
      UNION ALL
      SELECT 1 FROM erp_receber WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
    ) THEN RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501'; END IF;
  END IF;

  UPDATE erp_pagar SET status='cancelado', observacoes=COALESCE(observacoes,'')||v_obs, updated_at=NOW()
   WHERE id = ANY(p_lancamento_ids) AND status<>'cancelado';
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  UPDATE erp_receber SET status='cancelado', observacoes=COALESCE(observacoes,'')||v_obs, updated_at=NOW()
   WHERE id = ANY(p_lancamento_ids) AND status<>'cancelado';
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  RETURN QUERY SELECT array_length(p_lancamento_ids, 1), (v_n1 + v_n2), format('%s titulos cancelados', v_n1 + v_n2)::TEXT;
END;
$function$;

-- ── batch_alterar_vencimento ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.batch_alterar_vencimento(p_lancamento_ids uuid[], p_dias_adicionar integer, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_sucesso integer, mensagem text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_n1 INT := 0; v_n2 INT := 0;
  v_obs TEXT := E'\n[RENEGOCIADO] Vencimento alterado em ' || p_dias_adicionar || ' dias em ' || TO_CHAR(NOW(), 'DD/MM/YYYY');
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (
      SELECT 1 FROM erp_pagar   WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
      UNION ALL
      SELECT 1 FROM erp_receber WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
    ) THEN RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501'; END IF;
  END IF;

  UPDATE erp_pagar
     SET data_vencimento=(data_vencimento + (p_dias_adicionar || ' days')::INTERVAL)::date,
         observacoes=COALESCE(observacoes,'')||v_obs, updated_at=NOW()
   WHERE id = ANY(p_lancamento_ids) AND status IN ('aberto','vencido');
  GET DIAGNOSTICS v_n1 = ROW_COUNT;
  UPDATE erp_receber
     SET data_vencimento=(data_vencimento + (p_dias_adicionar || ' days')::INTERVAL)::date,
         observacoes=COALESCE(observacoes,'')||v_obs, em_renegociacao=true, updated_at=NOW()
   WHERE id = ANY(p_lancamento_ids) AND status IN ('aberto','vencido');
  GET DIAGNOSTICS v_n2 = ROW_COUNT;
  RETURN QUERY SELECT (v_n1 + v_n2), format('Vencimento alterado em %s titulos (+%s dias)', (v_n1 + v_n2), p_dias_adicionar)::TEXT;
END;
$function$;

-- ── fn_boleto_liquidar (tem p_company_id → guarda padrão direta) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(p_company_id uuid, p_nosso_numero text, p_data_pagamento date, p_valor_pago numeric DEFAULT NULL::numeric, p_provider_raw jsonb DEFAULT '{}'::jsonb, p_provider text DEFAULT 'sicoob'::text, p_banco_codigo text DEFAULT '756'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_receber record; v_conta_id uuid; v_baixa jsonb;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  SELECT id, status, valor, boleto_status INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id AND boleto_nosso_numero = p_nosso_numero
  ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado', 'nosso_numero', p_nosso_numero);
  END IF;
  IF v_receber.boleto_status = 'liquidado' OR v_receber.status = 'pago' THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true, 'receber_id', v_receber.id);
  END IF;

  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND provider = p_provider AND ambiente = 'producao' AND ativo = true
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id := v_receber.id, p_data_pagamento := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id, p_forma_pagamento := 'BOLETO',
    p_valor_pago := COALESCE(p_valor_pago, v_receber.valor), p_origem := 'boleto');

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa', 'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  UPDATE erp_receber SET boleto_status = 'liquidado', boleto_pago_em = NOW() WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES (p_company_id, p_banco_codigo, p_provider, 'boleto_liquidar', 'ok', 1,
        format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento), p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id, 'nosso_numero', p_nosso_numero, 'baixa', v_baixa);
END;
$function$;

-- ── ACL: fecha anon/public; escritores por título → authenticated (guarda filtra) + service_role ──
REVOKE EXECUTE ON FUNCTION public.batch_baixa_titulos(uuid[],date,uuid,varchar,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.batch_baixa_titulos(uuid[],date,uuid,varchar,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.batch_cancelar_titulos(uuid[],text,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.batch_cancelar_titulos(uuid[],text,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.batch_alterar_vencimento(uuid[],integer,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.batch_alterar_vencimento(uuid[],integer,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid,text,date,numeric,jsonb,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid,text,date,numeric,jsonb,text,text) TO authenticated, service_role;
