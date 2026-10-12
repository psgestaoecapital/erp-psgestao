-- BUG CRÍTICO (catch-up OMIE Tryo Gesso · fix 2): o sync dispara UM http_post
-- 'all' (empresa+categorias+clientes+pagar+receber) com pg_net timeout de 110s.
-- Empresa grande (Tryo Gesso, milhares de títulos) estoura os 110s → a resposta
-- do Vercel nunca chega ao Postgres → fn_processar_respostas_sync marca timeout e
-- o ETL (fn_etl_omie_empresa) NUNCA roda → nada entra. (O route.ts maxDuration já
-- é 300s; o gargalo é a janela do pg_net + o poller, não o Vercel.)
--
-- FIX (folga, sem re-arquitetar o cron): pg_net 110s → 280s (sob o teto de 300s do
-- route) e a janela "resposta não recebida" do poller 3min → 5min, coerente com
-- a folga maior. Com o fix (1) (ETL idempotente, sem abortar em duplicata), o
-- catch-up completa: ultimo_sync avança e a receita de mai–jul entra.
--
-- Escalonamento futuro (se uma empresa exceder ~280s): chunk por janela de data
-- (mês/semana) ou decouple do 'all' — MESMO padrão já usado para 'produtos' no
-- route.ts (BUG-OMIE-SYNC-TIMEOUT-v1). Fora deste hotfix.

CREATE OR REPLACE FUNCTION public.fn_sync_empresa(p_company_id uuid, p_trigger_type text DEFAULT 'cron'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_log_id uuid;
  v_request_id bigint;
  v_endpoint text := 'https://erp-psgestao.vercel.app/api/omie/sync';
  v_app_key text;
  v_app_secret text;
BEGIN
  SELECT omie_app_key, omie_app_secret
  INTO v_app_key, v_app_secret
  FROM companies
  WHERE id = p_company_id;

  IF v_app_key IS NULL OR v_app_secret IS NULL THEN
    INSERT INTO erp_sync_log (company_id, fase, erro, trigger_type, finalizado_em)
    VALUES (p_company_id, 'falha', 'Empresa sem credenciais Omie cadastradas', p_trigger_type, now())
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  INSERT INTO erp_sync_log (company_id, fase, trigger_type)
  VALUES (p_company_id, 'sync_omie', p_trigger_type)
  RETURNING id INTO v_log_id;

  SELECT net.http_post(
    url := v_endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'app_key', v_app_key,
      'app_secret', v_app_secret,
      'company_id', p_company_id::text,
      'sync_type', 'all'
    ),
    timeout_milliseconds := 280000   -- era 110000; folga p/ catch-up de empresa grande (route maxDuration=300s)
  ) INTO v_request_id;

  UPDATE erp_sync_log
  SET http_response = jsonb_build_object('pg_net_request_id', v_request_id)
  WHERE id = v_log_id;

  RETURN v_log_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_processar_respostas_sync()
 RETURNS TABLE(log_id uuid, status_final text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_record RECORD;
  v_etl_resultado jsonb;
BEGIN
  FOR v_record IN
    SELECT
      sl.id AS sync_log_id,
      sl.company_id,
      (sl.http_response->>'pg_net_request_id')::bigint AS request_id,
      sl.iniciado_em
    FROM erp_sync_log sl
    WHERE sl.fase = 'sync_omie'
      AND sl.http_response ? 'pg_net_request_id'
      AND sl.iniciado_em > now() - INTERVAL '15 minutes'
  LOOP
    DECLARE
      v_resp RECORD;
    BEGIN
      SELECT status_code, content::jsonb AS content_json, content AS content_text, error_msg
      INTO v_resp
      FROM net._http_response
      WHERE id = v_record.request_id;

      IF NOT FOUND THEN
        IF now() - v_record.iniciado_em > INTERVAL '5 minutes' THEN   -- era 3 min; alinhado à folga de 280s
          UPDATE erp_sync_log
          SET fase = 'timeout',
              finalizado_em = now(),
              erro = 'Resposta do Vercel não recebida em 5 minutos'
          WHERE id = v_record.sync_log_id;
          log_id := v_record.sync_log_id;
          status_final := 'timeout';
          RETURN NEXT;
        END IF;
        CONTINUE;
      END IF;

      IF v_resp.status_code BETWEEN 200 AND 299 THEN
        UPDATE erp_sync_log
        SET fase = 'etl',
            http_status = v_resp.status_code,
            http_response = v_resp.content_json
        WHERE id = v_record.sync_log_id;

        BEGIN
          SELECT jsonb_agg(
            jsonb_build_object(
              'etapa', t.etapa,
              'qtd_origem_omie', t.qtd_origem_omie,
              'qtd_processada', t.qtd_processada,
              'qtd_erp_atual', t.qtd_erp_atual
            )
          )
          INTO v_etl_resultado
          FROM fn_etl_omie_empresa(v_record.company_id) t;

          UPDATE erp_sync_log
          SET fase = 'sucesso',
              finalizado_em = now(),
              etl_resultado = v_etl_resultado
          WHERE id = v_record.sync_log_id;

          log_id := v_record.sync_log_id;
          status_final := 'sucesso';
          RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
          UPDATE erp_sync_log
          SET fase = 'falha',
              finalizado_em = now(),
              erro = 'Erro no ETL: ' || SQLERRM,
              erro_detalhe = jsonb_build_object('sqlstate', SQLSTATE, 'etapa', 'etl')
          WHERE id = v_record.sync_log_id;
          log_id := v_record.sync_log_id;
          status_final := 'falha_etl';
          RETURN NEXT;
        END;
      ELSE
        UPDATE erp_sync_log
        SET fase = 'falha',
            finalizado_em = now(),
            http_status = v_resp.status_code,
            http_response = COALESCE(v_resp.content_json, jsonb_build_object('raw', v_resp.content_text)),
            erro = COALESCE(v_resp.error_msg, 'HTTP ' || v_resp.status_code)
        WHERE id = v_record.sync_log_id;
        log_id := v_record.sync_log_id;
        status_final := 'falha_http';
        RETURN NEXT;
      END IF;
    END;
  END LOOP;

  RETURN;
END;
$function$;
