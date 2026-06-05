-- =============================================================
-- FEAT-PLUGGY-CONCILIACAO-FASE1-v1
-- =============================================================
-- Reusa plumbing Pluggy (connect, item, consent, dispatch_sync,
-- consume_sync) e adiciona consumidor financeiro: le contas BANK
-- de wealth_pluggy_raw e grava em conciliacao_movimento.
--
-- O caminho wealth continua intacto (client_id setado).
-- O caminho financeiro usa metadata->>'contexto'='financeiro'
-- + client_id NULL (precisa relaxar NOT NULL).
-- =============================================================

-- 1. Permitir client_id NULL pros itens financeiro
--    (wealth continua passando client_id, comportamento inalterado)
ALTER TABLE wealth_pluggy_items       ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE wealth_pluggy_consents    ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE wealth_pluggy_sync_log    ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE wealth_pluggy_sync_requests ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE wealth_pluggy_raw         ALTER COLUMN client_id DROP NOT NULL;

-- 2. Vinculo Pluggy <-> conta bancaria
ALTER TABLE erp_contas_bancarias
  ADD COLUMN IF NOT EXISTS pluggy_item_id text,
  ADD COLUMN IF NOT EXISTS pluggy_account_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_erp_contas_bancarias_pluggy_account
  ON erp_contas_bancarias (company_id, pluggy_account_id)
  WHERE pluggy_account_id IS NOT NULL;

-- 3. Idempotencia em conciliacao_movimento por (company_id, id_externo)
--    Permite re-sync sem duplicar transacoes.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conciliacao_movimento_company_idexterno
  ON conciliacao_movimento (company_id, id_externo)
  WHERE id_externo IS NOT NULL;

-- 4. Registrar item Pluggy no contexto financeiro
--    Reusa wealth_pluggy_items com client_id NULL + metadata.contexto.
CREATE OR REPLACE FUNCTION public.sp_pluggy_register_item_financeiro(
  p_company_id uuid,
  p_pluggy_item_id text,
  p_connector_id int,
  p_connector_name text,
  p_connector_type text,
  p_connector_image_url text DEFAULT NULL,
  p_consent_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_pluggy_item_id IS NULL THEN
    RAISE EXCEPTION 'company_id e pluggy_item_id obrigatorios';
  END IF;

  -- Tenta achar existente por (company_id, pluggy_item_id)
  SELECT id INTO v_id
  FROM wealth_pluggy_items
  WHERE company_id = p_company_id
    AND pluggy_item_id = p_pluggy_item_id
    AND COALESCE(metadata->>'contexto','') = 'financeiro'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE wealth_pluggy_items SET
      connector_name = COALESCE(p_connector_name, connector_name),
      connector_type = COALESCE(p_connector_type, connector_type),
      connector_image_url = COALESCE(p_connector_image_url, connector_image_url),
      consent_id = COALESCE(p_consent_id, consent_id),
      updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO wealth_pluggy_items (
    company_id, client_id, consent_id, pluggy_item_id,
    connector_id, connector_name, connector_type, connector_image_url,
    status, metadata
  ) VALUES (
    p_company_id, NULL, p_consent_id, p_pluggy_item_id,
    p_connector_id, p_connector_name, p_connector_type, p_connector_image_url,
    'UPDATING', jsonb_build_object('contexto', 'financeiro')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sp_pluggy_register_item_financeiro(uuid, text, int, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sp_pluggy_register_item_financeiro(uuid, text, int, text, text, text, uuid) TO authenticated, service_role;

-- 5. Consumidor financeiro: le raw Pluggy (accounts + transactions)
--    e grava em conciliacao_movimento. Idempotente via id_externo.
CREATE OR REPLACE FUNCTION public.sp_pluggy_promover_para_conciliacao(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_accounts_raw jsonb;
  v_transactions_raw jsonb;
  v_account jsonb;
  v_tx jsonb;
  v_conta_id uuid;
  v_lote_id uuid;
  v_acc_id text;
  v_acc_nome text;
  v_banco text;
  v_subtype text;
  v_qtd_contas int := 0;
  v_qtd_inseridas int := 0;
  v_qtd_ja_existiam int := 0;
  v_id_ext text;
  v_valor numeric;
  v_natureza text;
  v_data date;
BEGIN
  SELECT id, company_id, metadata, pluggy_item_id INTO v_item
  FROM wealth_pluggy_items WHERE id = p_item_id;
  IF v_item IS NULL OR COALESCE(v_item.metadata->>'contexto','') <> 'financeiro' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item nao e contexto financeiro');
  END IF;

  -- Ultimo raw accounts deste item
  SELECT payload INTO v_accounts_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'accounts'
  ORDER BY recebido_em DESC LIMIT 1;

  -- Ultimo raw transactions
  SELECT payload INTO v_transactions_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'transactions'
  ORDER BY recebido_em DESC LIMIT 1;

  IF v_accounts_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem raw accounts ainda; aguarde sync');
  END IF;

  -- Para cada conta tipo BANK no raw, garante erp_contas_bancarias + lote
  FOR v_account IN
    SELECT * FROM jsonb_array_elements(COALESCE(v_accounts_raw->'results', '[]'::jsonb))
    WHERE (value->>'type') = 'BANK'
  LOOP
    v_acc_id := v_account->>'id';
    v_acc_nome := COALESCE(v_account->>'name', v_account->>'marketingName', 'Conta bancária');
    v_subtype := v_account->>'subtype';
    v_banco := COALESCE(v_account->'bankData'->>'transferNumber', v_account->>'number', '');
    v_qtd_contas := v_qtd_contas + 1;

    -- Garante conta bancaria (idempotente por pluggy_account_id)
    SELECT id INTO v_conta_id
    FROM erp_contas_bancarias
    WHERE company_id = v_item.company_id AND pluggy_account_id = v_acc_id;
    IF v_conta_id IS NULL THEN
      INSERT INTO erp_contas_bancarias (
        company_id, nome, banco, conta, tipo,
        saldo_inicial, saldo_atual, ativo,
        pluggy_item_id, pluggy_account_id
      ) VALUES (
        v_item.company_id,
        v_acc_nome,
        COALESCE(v_account->>'marketingName', ''),
        v_banco,
        LOWER(COALESCE(v_subtype, 'corrente')),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        true,
        v_item.pluggy_item_id,
        v_acc_id
      ) RETURNING id INTO v_conta_id;
    ELSE
      UPDATE erp_contas_bancarias SET
        saldo_atual = COALESCE(NULLIF(v_account->>'balance','')::numeric, saldo_atual),
        updated_at = now()
      WHERE id = v_conta_id;
    END IF;

    -- Garante 1 lote aberto Pluggy por conta+item
    SELECT id INTO v_lote_id
    FROM conciliacao_lote
    WHERE company_id = v_item.company_id
      AND conta_bancaria_id = v_conta_id
      AND origem = 'pluggy'
      AND status = 'aberto'
    LIMIT 1;
    IF v_lote_id IS NULL THEN
      INSERT INTO conciliacao_lote (
        company_id, tipo, origem, nome, conta_bancaria_id, status
      ) VALUES (
        v_item.company_id, 'bancario', 'pluggy',
        'Pluggy · ' || v_acc_nome,
        v_conta_id, 'aberto'
      ) RETURNING id INTO v_lote_id;
    END IF;

    -- Insere transacoes BANK desta conta (idempotente · UNIQUE id_externo)
    IF v_transactions_raw IS NOT NULL THEN
      FOR v_tx IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_transactions_raw->'results', '[]'::jsonb))
        WHERE (value->>'accountId') = v_acc_id
      LOOP
        v_id_ext := 'pluggy:' || (v_tx->>'id');
        v_valor := COALESCE(NULLIF(v_tx->>'amount','')::numeric, 0);
        v_natureza := CASE WHEN v_valor >= 0 THEN 'credito' ELSE 'debito' END;
        v_valor := ABS(v_valor);
        v_data := COALESCE((v_tx->>'date')::date, CURRENT_DATE);

        BEGIN
          INSERT INTO conciliacao_movimento (
            lote_id, company_id,
            data_transacao, valor, natureza, descricao, id_externo,
            status
          ) VALUES (
            v_lote_id, v_item.company_id,
            v_data, v_valor, v_natureza,
            COALESCE(v_tx->>'description', v_tx->>'descriptionRaw', '—'),
            v_id_ext,
            'pendente'
          );
          v_qtd_inseridas := v_qtd_inseridas + 1;
        EXCEPTION WHEN unique_violation THEN
          v_qtd_ja_existiam := v_qtd_ja_existiam + 1;
        END;
      END LOOP;
    END IF;
  END LOOP;

  -- Marca metadata pra cron nao reprocessar muitas vezes
  UPDATE wealth_pluggy_items
  SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('last_conciliacao_em', now())
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'qtd_contas_bank', v_qtd_contas,
    'qtd_movimentos_inseridos', v_qtd_inseridas,
    'qtd_movimentos_ja_existiam', v_qtd_ja_existiam
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sp_pluggy_promover_para_conciliacao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sp_pluggy_promover_para_conciliacao(uuid) TO authenticated, service_role;

-- 6. Cron · scan financeiro items recem-sincronizados e promove
CREATE OR REPLACE FUNCTION public.fn_pluggy_promover_financeiro_recentes()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_qtd int := 0;
BEGIN
  FOR v_rec IN
    SELECT id FROM wealth_pluggy_items
    WHERE COALESCE(metadata->>'contexto','') = 'financeiro'
      AND ultimo_sync_em IS NOT NULL
      AND ultimo_sync_em >= now() - interval '1 hour'
      AND (
        metadata->>'last_conciliacao_em' IS NULL
        OR (metadata->>'last_conciliacao_em')::timestamptz < ultimo_sync_em
      )
    ORDER BY ultimo_sync_em
    LIMIT 50
  LOOP
    PERFORM public.sp_pluggy_promover_para_conciliacao(v_rec.id);
    v_qtd := v_qtd + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'promovidos', v_qtd, 'ts', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pluggy_promover_financeiro_recentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pluggy_promover_financeiro_recentes() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pluggy-promover-financeiro-recentes') THEN
    PERFORM cron.unschedule('pluggy-promover-financeiro-recentes');
  END IF;
END $$;

SELECT cron.schedule(
  'pluggy-promover-financeiro-recentes',
  '*/5 * * * *',
  $cron$ SELECT public.fn_pluggy_promover_financeiro_recentes(); $cron$
);

-- 7. Consentimento financeiro (LGPD/Open Finance) · client_id NULL
CREATE OR REPLACE FUNCTION public.sp_pluggy_consent_financeiro_aceitar(
  p_company_id uuid,
  p_texto_versao text DEFAULT 'pluggy-financeiro-v1',
  p_texto_md5 text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;

  INSERT INTO wealth_pluggy_consents (
    client_id, company_id, texto_consentimento_v, texto_consentimento_md5,
    hash_consentimento, ip, user_agent, aceito_em, aceito_por_user_id
  ) VALUES (
    NULL, p_company_id, p_texto_versao, p_texto_md5,
    md5(p_company_id::text || COALESCE(p_texto_md5,'') || COALESCE(v_user::text,'') || now()::text),
    p_ip, p_user_agent, now(), v_user
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sp_pluggy_consent_financeiro_aceitar(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sp_pluggy_consent_financeiro_aceitar(uuid, text, text, text, text) TO authenticated;
