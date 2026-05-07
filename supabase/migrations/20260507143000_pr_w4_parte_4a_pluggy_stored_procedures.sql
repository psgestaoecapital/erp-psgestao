-- supabase/migrations/20260507143000_pr_w4_parte_4a_pluggy_stored_procedures.sql
-- PR-W4 BLOCO 4A — Stored procedures Pluggy + cron (pattern fire-and-forget B-Prime)
--
-- Backend SQL puro para integracao Pluggy (Open Finance Brasil).
-- Mesmo padrao assincrono pg_net + cron usado no PR-W2 Brapi.
--
-- Pre-requisito: PARTE 0 + PARTE 1 aplicadas. Vault populado com
-- PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET. Extensions pg_net e pg_cron
-- habilitadas.
--
-- Autorizacao: CEO Gilberto Paravizi (Estrela Polar Secao 4 V1.2 + Secao 2 V1.1).

BEGIN;

-- ============================================================
-- 4A.0 Pre-flight
-- ============================================================
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='wealth_pluggy_items') THEN
    RAISE EXCEPTION 'Pre-flight FAIL: PARTE 1 nao aplicada (wealth_pluggy_items ausente)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='PLUGGY_CLIENT_ID') THEN
    RAISE EXCEPTION 'Pre-flight FAIL: PLUGGY_CLIENT_ID nao cadastrado no vault';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='PLUGGY_CLIENT_SECRET') THEN
    RAISE EXCEPTION 'Pre-flight FAIL: PLUGGY_CLIENT_SECRET nao cadastrado no vault';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'Pre-flight FAIL: extension pg_net nao habilitada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'Pre-flight FAIL: extension pg_cron nao habilitada';
  END IF;
  RAISE NOTICE 'Pre-flight OK: PARTE 0+1 aplicadas, vault populado, pg_net e pg_cron disponiveis';
END $preflight$;

-- ============================================================
-- 4A.1 Tabela auxiliar wealth_pluggy_sync_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS wealth_pluggy_sync_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id     uuid NOT NULL REFERENCES wealth_pluggy_sync_log(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES wealth_pluggy_items(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES wealth_clients(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('auth','accounts','investments','transactions','delete_item','patch_item')),
  request_id      bigint NOT NULL,
  consumido       boolean NOT NULL DEFAULT false,
  consumido_em    timestamptz,
  http_status     int,
  erro_msg        text,
  api_key_extraido text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pluggy_sync_req_pendentes
  ON wealth_pluggy_sync_requests (sync_log_id) WHERE consumido = false;
CREATE INDEX IF NOT EXISTS idx_pluggy_sync_req_item
  ON wealth_pluggy_sync_requests (item_id, created_at DESC);

ALTER TABLE wealth_pluggy_sync_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pluggy_sync_req_admin ON wealth_pluggy_sync_requests;
CREATE POLICY pluggy_sync_req_admin ON wealth_pluggy_sync_requests
  FOR SELECT USING (fn_wealth_user_pode_ver_tudo());

DROP POLICY IF EXISTS pluggy_sync_req_operador ON wealth_pluggy_sync_requests;
CREATE POLICY pluggy_sync_req_operador ON wealth_pluggy_sync_requests
  FOR SELECT USING (fn_wealth_user_eh_operador(client_id));

DROP POLICY IF EXISTS pluggy_sync_req_service ON wealth_pluggy_sync_requests;
CREATE POLICY pluggy_sync_req_service ON wealth_pluggy_sync_requests
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 4A.2 fn_pluggy_get_credentials (RPC interno SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_pluggy_get_credentials()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'vault'
AS $$
DECLARE
  v_client_id     text;
  v_client_secret text;
BEGIN
  SELECT decrypted_secret INTO v_client_id
  FROM vault.decrypted_secrets WHERE name = 'PLUGGY_CLIENT_ID' LIMIT 1;
  SELECT decrypted_secret INTO v_client_secret
  FROM vault.decrypted_secrets WHERE name = 'PLUGGY_CLIENT_SECRET' LIMIT 1;
  IF v_client_id IS NULL OR v_client_secret IS NULL THEN
    RETURN jsonb_build_object('error', 'credentials_missing');
  END IF;
  RETURN jsonb_build_object('client_id', v_client_id, 'client_secret', v_client_secret);
END;
$$;

REVOKE ALL ON FUNCTION fn_pluggy_get_credentials() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_pluggy_get_credentials() TO service_role;

-- ============================================================
-- 4A.3 sp_pluggy_register_item
-- ============================================================
CREATE OR REPLACE FUNCTION sp_pluggy_register_item(
  p_client_id        uuid,
  p_consent_id       uuid,
  p_pluggy_item_id   text,
  p_connector_id     int,
  p_connector_name   text,
  p_connector_type   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_company_id uuid;
  v_item_id    uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM wealth_clients WHERE id = p_client_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Client nao encontrado: %', p_client_id;
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
$$;

REVOKE ALL ON FUNCTION sp_pluggy_register_item(uuid, uuid, text, int, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION sp_pluggy_register_item(uuid, uuid, text, int, text, text) TO authenticated, service_role;

-- ============================================================
-- 4A.4 sp_pluggy_dispatch_sync (fire-and-forget)
-- ============================================================
CREATE OR REPLACE FUNCTION sp_pluggy_dispatch_sync(
  p_item_id   uuid,
  p_origem    text DEFAULT 'manual'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'net'
AS $$
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
$$;

REVOKE ALL ON FUNCTION sp_pluggy_dispatch_sync(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION sp_pluggy_dispatch_sync(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 4A.5 sp_pluggy_consume_sync (encadeia auth -> accounts/investments/transactions)
-- ============================================================
CREATE OR REPLACE FUNCTION sp_pluggy_consume_sync(p_sync_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'net'
AS $$
DECLARE
  v_log              record;
  v_item             record;
  v_req              record;
  v_resp             record;
  v_content          jsonb;
  v_api_key          text;
  v_total_accounts   int := 0;
  v_total_investments int := 0;
  v_total_transactions int := 0;
  v_total_inseridas  int := 0;
  v_total_atualizadas int := 0;
  v_pendentes        int;
  v_status_final     text;
  v_request_id       bigint;
  v_from_date        text;
  v_inv              jsonb;
  v_asset_id         uuid;
  v_existing_pos     uuid;
BEGIN
  SELECT * INTO v_log FROM wealth_pluggy_sync_log WHERE id = p_sync_log_id;
  IF v_log IS NULL THEN
    RETURN jsonb_build_object('error', 'sync_log_not_found');
  END IF;
  SELECT * INTO v_item FROM wealth_pluggy_items WHERE id = v_log.item_id;
  SELECT api_key_extraido INTO v_api_key
  FROM wealth_pluggy_sync_requests
  WHERE sync_log_id = p_sync_log_id AND tipo = 'auth' AND consumido = true
    AND api_key_extraido IS NOT NULL LIMIT 1;
  FOR v_req IN
    SELECT id, tipo, request_id FROM wealth_pluggy_sync_requests
    WHERE sync_log_id = p_sync_log_id AND consumido = false
    ORDER BY created_at ASC
  LOOP
    BEGIN
      SELECT id, status_code, content, error_msg INTO v_resp
      FROM net._http_response WHERE id = v_req.request_id;
      IF v_resp.id IS NULL THEN CONTINUE; END IF;
      UPDATE wealth_pluggy_sync_requests
      SET consumido = true, consumido_em = now(),
          http_status = v_resp.status_code, erro_msg = v_resp.error_msg
      WHERE id = v_req.id;
      IF v_resp.error_msg IS NOT NULL OR v_resp.status_code IS NULL OR v_resp.status_code >= 400 THEN
        CONTINUE;
      END IF;
      v_content := v_resp.content::jsonb;
      IF v_req.tipo = 'auth' THEN
        v_api_key := v_content->>'apiKey';
        IF v_api_key IS NULL THEN CONTINUE; END IF;
        UPDATE wealth_pluggy_sync_requests SET api_key_extraido = v_api_key WHERE id = v_req.id;
        SELECT net.http_get(
          url := 'https://api.pluggy.ai/accounts?itemId=' || v_item.pluggy_item_id,
          headers := jsonb_build_object('X-API-KEY', v_api_key),
          timeout_milliseconds := 15000
        ) INTO v_request_id;
        INSERT INTO wealth_pluggy_sync_requests (sync_log_id, item_id, client_id, tipo, request_id)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'accounts', v_request_id);
        SELECT net.http_get(
          url := 'https://api.pluggy.ai/investments?itemId=' || v_item.pluggy_item_id,
          headers := jsonb_build_object('X-API-KEY', v_api_key),
          timeout_milliseconds := 15000
        ) INTO v_request_id;
        INSERT INTO wealth_pluggy_sync_requests (sync_log_id, item_id, client_id, tipo, request_id)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'investments', v_request_id);
        v_from_date := COALESCE(to_char(v_item.ultimo_sync_em, 'YYYY-MM-DD'), '2024-01-01');
        SELECT net.http_get(
          url := 'https://api.pluggy.ai/transactions?itemId=' || v_item.pluggy_item_id || '&from=' || v_from_date,
          headers := jsonb_build_object('X-API-KEY', v_api_key),
          timeout_milliseconds := 15000
        ) INTO v_request_id;
        INSERT INTO wealth_pluggy_sync_requests (sync_log_id, item_id, client_id, tipo, request_id)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'transactions', v_request_id);
      ELSIF v_req.tipo = 'accounts' THEN
        INSERT INTO wealth_pluggy_raw (sync_log_id, item_id, client_id, tipo_payload, payload)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'accounts', v_content);
        v_total_accounts := jsonb_array_length(COALESCE(v_content->'results', '[]'::jsonb));
      ELSIF v_req.tipo = 'investments' THEN
        INSERT INTO wealth_pluggy_raw (sync_log_id, item_id, client_id, tipo_payload, payload)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'investments', v_content);
        v_total_investments := jsonb_array_length(COALESCE(v_content->'results', '[]'::jsonb));
        FOR v_inv IN SELECT * FROM jsonb_array_elements(COALESCE(v_content->'results', '[]'::jsonb))
        LOOP
          BEGIN
            SELECT id INTO v_asset_id FROM wealth_assets
            WHERE (ticker = v_inv->>'code' OR isin = v_inv->>'isin') AND ativo = true LIMIT 1;
            IF v_asset_id IS NULL AND v_inv->>'code' IS NOT NULL THEN
              INSERT INTO wealth_assets (
                ticker, nome, classe, isin, moeda,
                cotacao_atual, cotacao_atualizada_em, ativo
              ) VALUES (
                v_inv->>'code',
                COALESCE(v_inv->>'name', v_inv->>'code'),
                CASE
                  WHEN v_inv->>'type' = 'EQUITY' THEN 'renda_variavel'
                  WHEN v_inv->>'type' = 'FIXED_INCOME' THEN 'renda_fixa_pos'
                  WHEN v_inv->>'type' = 'MUTUAL_FUND' THEN 'fundos'
                  WHEN v_inv->>'type' = 'ETF' THEN 'etf'
                  ELSE 'outros'
                END,
                v_inv->>'isin',
                COALESCE(v_inv->>'currencyCode', 'BRL'),
                NULLIF(v_inv->>'value', '')::numeric,
                now(), true
              ) RETURNING id INTO v_asset_id;
            END IF;
            IF v_asset_id IS NULL THEN CONTINUE; END IF;
            SELECT id INTO v_existing_pos FROM wealth_positions
            WHERE client_id = v_item.client_id AND asset_id = v_asset_id LIMIT 1;
            IF v_existing_pos IS NULL THEN
              INSERT INTO wealth_positions (
                client_id, asset_id, quantidade, preco_medio,
                valor_atual, moeda_compra, instituicao
              ) VALUES (
                v_item.client_id, v_asset_id,
                COALESCE(NULLIF(v_inv->>'balance', '')::numeric, NULLIF(v_inv->>'quantity', '')::numeric, 0),
                NULLIF(v_inv->>'amount', '')::numeric,
                NULLIF(v_inv->>'value', '')::numeric,
                COALESCE(v_inv->>'currencyCode', 'BRL'),
                v_inv->>'issuer'
              );
              v_total_inseridas := v_total_inseridas + 1;
            ELSE
              UPDATE wealth_positions
              SET quantidade = COALESCE(NULLIF(v_inv->>'balance', '')::numeric, NULLIF(v_inv->>'quantity', '')::numeric, quantidade),
                  valor_atual = COALESCE(NULLIF(v_inv->>'value', '')::numeric, valor_atual),
                  updated_at = now()
              WHERE id = v_existing_pos;
              v_total_atualizadas := v_total_atualizadas + 1;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            UPDATE wealth_pluggy_sync_requests
            SET erro_msg = COALESCE(erro_msg, '') || ' | invest_err: ' || SQLERRM
            WHERE id = v_req.id;
          END;
        END LOOP;
      ELSIF v_req.tipo = 'transactions' THEN
        INSERT INTO wealth_pluggy_raw (sync_log_id, item_id, client_id, tipo_payload, payload)
        VALUES (p_sync_log_id, v_item.id, v_item.client_id, 'transactions', v_content);
        v_total_transactions := jsonb_array_length(COALESCE(v_content->'results', '[]'::jsonb));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE wealth_pluggy_sync_requests
      SET consumido = true, erro_msg = SQLERRM, consumido_em = now()
      WHERE id = v_req.id;
    END;
  END LOOP;
  SELECT COUNT(*) INTO v_pendentes FROM wealth_pluggy_sync_requests
  WHERE sync_log_id = p_sync_log_id AND consumido = false;
  UPDATE wealth_pluggy_sync_log
  SET total_accounts = v_total_accounts,
      total_investments = v_total_investments,
      total_transactions = v_total_transactions,
      total_inseridas = v_total_inseridas,
      total_atualizadas = v_total_atualizadas,
      duracao_ms = EXTRACT(EPOCH FROM (now() - v_log.executado_em)) * 1000
  WHERE id = p_sync_log_id;
  IF v_pendentes > 0 THEN
    RETURN jsonb_build_object('sync_log_id', p_sync_log_id, 'status', 'parcial', 'pendentes', v_pendentes);
  END IF;
  IF EXISTS (SELECT 1 FROM wealth_pluggy_sync_requests
             WHERE sync_log_id = p_sync_log_id AND erro_msg IS NOT NULL) THEN
    v_status_final := 'parcial';
  ELSE
    v_status_final := 'sucesso';
  END IF;
  UPDATE wealth_pluggy_sync_log SET status = v_status_final WHERE id = p_sync_log_id;
  UPDATE wealth_pluggy_items
  SET status = CASE WHEN v_status_final='sucesso' THEN 'UPDATED' ELSE 'OUTDATED' END,
      ultimo_sync_em = now(),
      proxima_sync_em = now() + interval '24 hours',
      updated_at = now()
  WHERE id = v_log.item_id;
  RETURN jsonb_build_object(
    'sync_log_id', p_sync_log_id, 'status', v_status_final,
    'accounts', v_total_accounts, 'investments', v_total_investments,
    'transactions', v_total_transactions,
    'inseridas', v_total_inseridas, 'atualizadas', v_total_atualizadas
  );
END;
$$;

REVOKE ALL ON FUNCTION sp_pluggy_consume_sync(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION sp_pluggy_consume_sync(uuid) TO authenticated, service_role;

-- ============================================================
-- 4A.6 sp_pluggy_revoke_item (LGPD Art 18, preserva historico CVM 5 anos)
-- ============================================================
CREATE OR REPLACE FUNCTION sp_pluggy_revoke_item(
  p_item_id  uuid,
  p_motivo   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item record;
BEGIN
  SELECT * INTO v_item FROM wealth_pluggy_items WHERE id = p_item_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'Item nao encontrado: %', p_item_id;
  END IF;
  IF v_item.status IN ('REVOKED', 'DELETED') THEN
    RETURN jsonb_build_object('status', 'ja_revogado', 'item_id', p_item_id);
  END IF;
  UPDATE wealth_pluggy_items
  SET status = 'REVOKED', updated_at = now()
  WHERE id = p_item_id;
  UPDATE wealth_pluggy_consents
  SET revogado_em = now(),
      revogado_por_user_id = auth.uid(),
      motivo_revogacao = COALESCE(p_motivo, 'Revogado pelo usuario')
  WHERE id = v_item.consent_id AND revogado_em IS NULL;
  RETURN jsonb_build_object(
    'status', 'revogado', 'item_id', p_item_id,
    'consent_id', v_item.consent_id, 'motivo', p_motivo
  );
END;
$$;

REVOKE ALL ON FUNCTION sp_pluggy_revoke_item(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION sp_pluggy_revoke_item(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 4A.7 sp_pluggy_sync_diario (orquestrador chamado pelo cron)
-- ============================================================
CREATE OR REPLACE FUNCTION sp_pluggy_sync_diario(
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item            record;
  v_sync_log_id     uuid;
  v_disparados      int := 0;
  v_consumidos      int := 0;
  v_log_pendente    record;
BEGIN
  FOR v_item IN
    SELECT id FROM wealth_pluggy_items
    WHERE status = 'UPDATED'
      AND (p_company_id IS NULL OR company_id = p_company_id)
      AND (proxima_sync_em IS NULL OR proxima_sync_em <= now())
    ORDER BY ultimo_sync_em ASC NULLS FIRST LIMIT 50
  LOOP
    BEGIN
      v_sync_log_id := sp_pluggy_dispatch_sync(v_item.id, 'cron');
      v_disparados := v_disparados + 1;
      PERFORM pg_sleep(0.2);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  FOR v_log_pendente IN
    SELECT DISTINCT sync_log_id FROM wealth_pluggy_sync_requests
    WHERE consumido = false AND created_at > now() - interval '1 hour'
  LOOP
    BEGIN
      PERFORM sp_pluggy_consume_sync(v_log_pendente.sync_log_id);
      v_consumidos := v_consumidos + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'disparados', v_disparados, 'consumidos', v_consumidos,
    'executado_em', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION sp_pluggy_sync_diario(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION sp_pluggy_sync_diario(uuid) TO authenticated, service_role;

-- ============================================================
-- 4A.8 Cron jobs
-- ============================================================
SELECT cron.schedule(
  'wealth-pluggy-sync-diario',
  '0 9 * * 1-5',
  $cron$ SELECT public.sp_pluggy_sync_diario(); $cron$
);

SELECT cron.schedule(
  'wealth-pluggy-consume-pending',
  '*/5 * * * *',
  $cron$
    SELECT sp_pluggy_consume_sync(sync_log_id)
    FROM (
      SELECT DISTINCT sync_log_id FROM wealth_pluggy_sync_requests
      WHERE consumido = false AND created_at > now() - interval '15 minutes'
      LIMIT 20
    ) AS pending;
  $cron$
);

-- ============================================================
-- 4A.9 Validacao
-- ============================================================
DO $validate$
DECLARE
  v_funcoes int;
  v_crons int;
  v_tabela_aux int;
BEGIN
  SELECT COUNT(*) INTO v_funcoes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'fn_pluggy_get_credentials','sp_pluggy_register_item',
    'sp_pluggy_dispatch_sync','sp_pluggy_consume_sync',
    'sp_pluggy_revoke_item','sp_pluggy_sync_diario'
  );
  SELECT COUNT(*) INTO v_crons FROM cron.job
  WHERE jobname IN ('wealth-pluggy-sync-diario', 'wealth-pluggy-consume-pending');
  SELECT COUNT(*) INTO v_tabela_aux FROM information_schema.tables
  WHERE table_schema='public' AND table_name='wealth_pluggy_sync_requests';
  IF v_funcoes <> 6 THEN
    RAISE EXCEPTION 'Erro: 6 funcoes esperadas, encontradas %', v_funcoes;
  END IF;
  IF v_crons <> 2 THEN
    RAISE EXCEPTION 'Erro: 2 cron jobs esperados, encontrados %', v_crons;
  END IF;
  IF v_tabela_aux <> 1 THEN
    RAISE EXCEPTION 'Erro: tabela wealth_pluggy_sync_requests nao foi criada';
  END IF;
  RAISE NOTICE 'BLOCO 4A OK: % funcoes, % cron jobs, tabela auxiliar criada', v_funcoes, v_crons;
END $validate$;

COMMIT;
