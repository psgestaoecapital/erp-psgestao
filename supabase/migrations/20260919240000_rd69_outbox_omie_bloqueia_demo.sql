-- RD-69 Parte 1 (exclusões is_demo · envios reais) — outbox Omie NÃO dispara para empresa demo
--
-- fn_outbox_omie_dispatch / fn_outbox_omie_processar postam registros financeiros REAIS na API viva
-- do Omie (https://app.omie.com.br/api/v1/…) usando as credenciais da empresa. Uma empresa de
-- DEMONSTRAÇÃO (companies.is_demo=true) jamais pode empurrar dado para o Omie — seria dado fictício
-- entrando na contabilidade real de alguém. Hoje isso só não acontece por acidente (demo não tem
-- credencial → cai em NO_CREDENTIALS), e há 55 linhas de outbox de demo já existentes (todas
-- 'cancelado'). RD-69 exige a trava explícita: no PONTO DE ENVIO, empresa is_demo é recusada com
-- skip permanente (não reprocessa), antes de qualquer HTTP. Corpo idêntico ao vivo + só o guard.

-- ── fn_outbox_omie_dispatch ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_outbox_omie_dispatch(p_outbox_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_outbox record;
  v_config record;
  v_app_key text;
  v_app_secret text;
  v_endpoint text;
  v_method text;
  v_request_id bigint;
  v_op_short text;
BEGIN
  SELECT * INTO v_outbox FROM erp_outbox_sync WHERE id = p_outbox_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'outbox nao encontrado');
  END IF;

  -- RD-69: empresa de demonstracao (is_demo) JAMAIS envia dado real ao Omie. Skip permanente.
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_outbox.company_id AND is_demo IS TRUE) THEN
    PERFORM fn_outbox_marcar_erro(
      p_outbox_id, 'EMPRESA_DEMO',
      'Empresa de demonstracao (is_demo): sync Omie bloqueado por RD-69', NULL, true
    );
    RETURN jsonb_build_object('skipped', true, 'reason', 'empresa_demo');
  END IF;

  SELECT * INTO v_config
  FROM erp_provider_config
  WHERE company_id = v_outbox.company_id
    AND provider = 'omie';

  IF NOT FOUND OR v_config.sync_mode IN ('paused', 'read_only') THEN
    PERFORM fn_outbox_marcar_erro(
      p_outbox_id, 'SYNC_MODE_DISABLED',
      format('Provider config: %s', COALESCE(v_config.sync_mode, 'no_config')),
      NULL, true
    );
    RETURN jsonb_build_object('skipped', true, 'reason', 'sync_disabled');
  END IF;

  -- ========================================
  -- SHADOW MODE: marca e nao envia
  -- ========================================
  IF v_config.sync_mode = 'shadow_mode' THEN
    UPDATE erp_outbox_sync
    SET shadow_run = true,
        status = 'sucesso',
        payload_response = jsonb_build_object(
          'shadow', true,
          'message', 'Shadow mode: payload capturado, nao enviado ao Omie',
          'would_send_to', 'omie',
          'captured_at', now()
        ),
        concluido_em = now(),
        updated_at = now()
    WHERE id = p_outbox_id;

    RETURN jsonb_build_object('success', true, 'shadow_mode', true);
  END IF;

  -- ========================================
  -- SOFT LAUNCH: aplicar limites
  -- ========================================
  IF v_config.soft_launch_active THEN
    IF v_config.soft_launch_last_reset < CURRENT_DATE THEN
      UPDATE erp_provider_config
      SET soft_launch_ops_today = 0,
          soft_launch_last_reset = CURRENT_DATE
      WHERE id = v_config.id;
      v_config.soft_launch_ops_today := 0;
    END IF;

    IF v_config.soft_launch_max_ops_per_day IS NOT NULL
       AND v_config.soft_launch_ops_today >= v_config.soft_launch_max_ops_per_day THEN
      PERFORM fn_outbox_marcar_erro(
        p_outbox_id, 'SOFT_LAUNCH_DAILY_LIMIT',
        format('Limite diario soft launch atingido: %s ops', v_config.soft_launch_max_ops_per_day),
        NULL, false
      );
      RETURN jsonb_build_object('skipped', true, 'reason', 'daily_limit');
    END IF;

    v_op_short := split_part(v_outbox.operacao, '.', 2);
    IF v_config.soft_launch_allowed_operations IS NOT NULL
       AND NOT (v_op_short = ANY(v_config.soft_launch_allowed_operations)) THEN
      PERFORM fn_outbox_marcar_erro(
        p_outbox_id, 'SOFT_LAUNCH_OP_NOT_ALLOWED',
        format('Operacao %s nao permitida em soft launch (apenas: %s)',
               v_op_short, array_to_string(v_config.soft_launch_allowed_operations, ',')),
        NULL, true
      );
      RETURN jsonb_build_object('skipped', true, 'reason', 'op_not_allowed');
    END IF;

    IF v_config.soft_launch_max_value IS NOT NULL
       AND (v_outbox.payload_request->>'valor')::numeric > v_config.soft_launch_max_value THEN
      PERFORM fn_outbox_marcar_erro(
        p_outbox_id, 'SOFT_LAUNCH_VALUE_LIMIT',
        format('Valor R$ %s acima do limite soft launch R$ %s',
               v_outbox.payload_request->>'valor', v_config.soft_launch_max_value),
        NULL, true
      );
      RETURN jsonb_build_object('skipped', true, 'reason', 'value_limit');
    END IF;
  END IF;

  -- ========================================
  -- WRITE_BACK normal: enviar ao Omie
  -- ========================================
  SELECT omie_app_key, omie_app_secret INTO v_app_key, v_app_secret
  FROM companies WHERE id = v_outbox.company_id;

  IF v_app_key IS NULL THEN
    PERFORM fn_outbox_marcar_erro(p_outbox_id, 'NO_CREDENTIALS', 'Sem credenciais Omie', NULL, true);
    RETURN jsonb_build_object('error', 'sem credenciais');
  END IF;

  CASE v_outbox.operacao
    WHEN 'pagar.baixar'    THEN v_endpoint := 'financas/contapagar/';   v_method := 'LancarPagamento';
    WHEN 'pagar.alterar'   THEN v_endpoint := 'financas/contapagar/';   v_method := 'AlterarContaPagar';
    WHEN 'pagar.incluir'   THEN v_endpoint := 'financas/contapagar/';   v_method := 'IncluirContaPagar';
    WHEN 'pagar.excluir'   THEN v_endpoint := 'financas/contapagar/';   v_method := 'ExcluirContaPagar';
    WHEN 'pagar.estornar'  THEN v_endpoint := 'financas/contapagar/';   v_method := 'EstornarContaPagar';
    WHEN 'receber.baixar'  THEN v_endpoint := 'financas/contareceber/'; v_method := 'LancarRecebimento';
    WHEN 'receber.alterar' THEN v_endpoint := 'financas/contareceber/'; v_method := 'AlterarContaReceber';
    WHEN 'receber.incluir' THEN v_endpoint := 'financas/contareceber/'; v_method := 'IncluirContaReceber';
    WHEN 'receber.excluir' THEN v_endpoint := 'financas/contareceber/'; v_method := 'ExcluirContaReceber';
    WHEN 'receber.estornar' THEN v_endpoint := 'financas/contareceber/'; v_method := 'EstornarContaReceber';
    ELSE
      PERFORM fn_outbox_marcar_erro(p_outbox_id, 'OP_NOT_SUPPORTED', 'Operacao: ' || v_outbox.operacao, NULL, true);
      RETURN jsonb_build_object('error', 'op nao suportada');
  END CASE;

  SELECT net.http_post(
    url := 'https://app.omie.com.br/api/v1/' || v_endpoint,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'call', v_method,
      'app_key', v_app_key,
      'app_secret', v_app_secret,
      'param', jsonb_build_array(v_outbox.payload_request)
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  UPDATE erp_outbox_sync
  SET http_request_id = v_request_id,
      dispatched_at = now(),
      updated_at = now()
  WHERE id = p_outbox_id;

  IF v_config.soft_launch_active THEN
    UPDATE erp_provider_config
    SET soft_launch_ops_today = soft_launch_ops_today + 1
    WHERE id = v_config.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'http_request_id', v_request_id);
END;
$function$;

-- ── fn_outbox_omie_processar ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_outbox_omie_processar(p_outbox_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_outbox record;
  v_app_key text;
  v_app_secret text;
  v_endpoint text;
  v_method text;
  v_request_body jsonb;
  v_request_id bigint;
  v_response record;
  v_tentativas int;
  v_response_data jsonb;
  v_remote_id text;
  v_erro_codigo text;
  v_erro_msg text;
BEGIN
  -- Pegar o outbox
  SELECT * INTO v_outbox FROM erp_outbox_sync WHERE id = p_outbox_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'outbox nao encontrado');
  END IF;

  -- RD-69: empresa de demonstracao (is_demo) JAMAIS envia dado real ao Omie. Skip permanente.
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_outbox.company_id AND is_demo IS TRUE) THEN
    PERFORM fn_outbox_marcar_erro(
      p_outbox_id, 'EMPRESA_DEMO',
      'Empresa de demonstracao (is_demo): sync Omie bloqueado por RD-69', NULL, true
    );
    RETURN jsonb_build_object('skipped', true, 'reason', 'empresa_demo');
  END IF;

  -- Credenciais Omie da empresa
  SELECT omie_app_key, omie_app_secret INTO v_app_key, v_app_secret
  FROM companies WHERE id = v_outbox.company_id;

  IF v_app_key IS NULL THEN
    PERFORM fn_outbox_marcar_erro(
      p_outbox_id, 'NO_CREDENTIALS', 'Empresa sem credenciais Omie configuradas', NULL, true
    );
    RETURN jsonb_build_object('error', 'sem credenciais');
  END IF;

  -- Mapear operacao -> endpoint Omie + method
  CASE v_outbox.operacao
    WHEN 'pagar.baixar' THEN
      v_endpoint := 'financas/contapagar/';
      v_method := 'LancarPagamento';
    WHEN 'pagar.alterar' THEN
      v_endpoint := 'financas/contapagar/';
      v_method := 'AlterarContaPagar';
    WHEN 'pagar.incluir' THEN
      v_endpoint := 'financas/contapagar/';
      v_method := 'IncluirContaPagar';
    WHEN 'pagar.excluir' THEN
      v_endpoint := 'financas/contapagar/';
      v_method := 'ExcluirContaPagar';
    WHEN 'receber.baixar' THEN
      v_endpoint := 'financas/contareceber/';
      v_method := 'LancarRecebimento';
    WHEN 'receber.alterar' THEN
      v_endpoint := 'financas/contareceber/';
      v_method := 'AlterarContaReceber';
    WHEN 'receber.incluir' THEN
      v_endpoint := 'financas/contareceber/';
      v_method := 'IncluirContaReceber';
    WHEN 'receber.excluir' THEN
      v_endpoint := 'financas/contareceber/';
      v_method := 'ExcluirContaReceber';
    ELSE
      PERFORM fn_outbox_marcar_erro(
        p_outbox_id, 'OP_NOT_SUPPORTED', 'Operacao Omie nao suportada: ' || v_outbox.operacao, NULL, true
      );
      RETURN jsonb_build_object('error', 'operacao nao suportada');
  END CASE;

  -- Construir body Omie
  v_request_body := jsonb_build_object(
    'call', v_method,
    'app_key', v_app_key,
    'app_secret', v_app_secret,
    'param', jsonb_build_array(v_outbox.payload_request)
  );

  -- Disparar HTTP
  SELECT net.http_post(
    url := 'https://app.omie.com.br/api/v1/' || v_endpoint,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := v_request_body,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  -- Aguardar resposta (poll)
  v_tentativas := 0;
  LOOP
    v_tentativas := v_tentativas + 1;
    EXIT WHEN v_tentativas > 60;  -- ate 30s
    SELECT id, status_code, timed_out, error_msg, content INTO v_response
    FROM net._http_response WHERE id = v_request_id;
    EXIT WHEN v_response.id IS NOT NULL AND (v_response.status_code IS NOT NULL OR v_response.timed_out OR v_response.error_msg IS NOT NULL);
    PERFORM pg_sleep(0.5);
  END LOOP;

  -- Avaliar resposta
  IF v_response.timed_out THEN
    PERFORM fn_outbox_marcar_erro(p_outbox_id, 'TIMEOUT', 'Timeout aguardando Omie', NULL, false);
    RETURN jsonb_build_object('error', 'timeout');
  END IF;

  IF v_response.error_msg IS NOT NULL THEN
    PERFORM fn_outbox_marcar_erro(p_outbox_id, 'NETWORK', v_response.error_msg, NULL, false);
    RETURN jsonb_build_object('error', v_response.error_msg);
  END IF;

  v_response_data := v_response.content::jsonb;

  -- Sucesso (200/201)
  IF v_response.status_code BETWEEN 200 AND 299 THEN
    -- Tentar extrair codigo_lancamento_omie da resposta
    v_remote_id := COALESCE(
      v_response_data->>'codigo_lancamento_omie',
      v_response_data->>'nCodTitulo',
      v_response_data->>'codigo_lancamento'
    );

    PERFORM fn_outbox_marcar_sucesso(
      p_outbox_id,
      v_response_data,
      v_remote_id,
      'codigo_lancamento_omie'
    );
    RETURN jsonb_build_object('success', true, 'remote_id', v_remote_id);
  END IF;

  -- Erro de negocio (4xx) - permanente
  IF v_response.status_code BETWEEN 400 AND 499 THEN
    v_erro_codigo := COALESCE(v_response_data->>'faultcode', 'HTTP_' || v_response.status_code);
    v_erro_msg := COALESCE(v_response_data->>'faultstring', v_response_data->>'detalhes', 'Erro Omie');
    PERFORM fn_outbox_marcar_erro(p_outbox_id, v_erro_codigo, v_erro_msg, v_response_data, true);
    RETURN jsonb_build_object('error', v_erro_msg, 'permanente', true);
  END IF;

  -- Erro de servidor (5xx) - retentar
  v_erro_msg := 'Omie respondeu ' || v_response.status_code;
  PERFORM fn_outbox_marcar_erro(p_outbox_id, 'HTTP_' || v_response.status_code, v_erro_msg, v_response_data, false);
  RETURN jsonb_build_object('error', v_erro_msg, 'retry', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM fn_outbox_marcar_erro(p_outbox_id, 'EXCEPTION', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE), false);
  RETURN jsonb_build_object('error', SQLERRM);
END;
$function$;
