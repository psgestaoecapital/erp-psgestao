-- =============================================================
-- FEAT-PLUGGY-ONDAB1-CANONICA-v1 · Pluggy -> erp_banco_contas
-- =============================================================
-- Onda B1 · decisao CEO 12/06/2026 · motor operator-agnostic,
-- company_id-scoped (serve GE + BPO).
--
-- Aterra a ponte Pluggy na tabela canonica erp_banco_contas
-- (44 contas reais hoje) em vez de duplicar em wealth_contas_bancarias.
--
-- Mudancas:
--   1) erp_banco_contas ganha pluggy_item_id + pluggy_account_id
--   2) Indice unico (company_id, pluggy_account_id) WHERE NOT NULL
--      garante 1 conta Pluggy por empresa (anti-duplicata)
--   3) Indice unico (lote_id, id_externo) WHERE NOT NULL em
--      conciliacao_movimento faz o EXCEPTION unique_violation
--      funcionar de verdade (idempotencia de movimento)
--   4) sp_pluggy_promover_para_conciliacao reescrita pra apontar
--      erp_banco_contas com colunas corretas (tipo_conta,
--      incluir_no_fluxo, soma_no_saldo, incluir_no_resumo)
--
-- Migration aplicada via MCP em 2026-06-12.
-- =============================================================

ALTER TABLE public.erp_banco_contas
  ADD COLUMN IF NOT EXISTS pluggy_item_id    text,
  ADD COLUMN IF NOT EXISTS pluggy_account_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_banco_contas_pluggy_acc
  ON public.erp_banco_contas (company_id, pluggy_account_id)
  WHERE pluggy_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacao_movimento_idext
  ON public.conciliacao_movimento (lote_id, id_externo)
  WHERE id_externo IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sp_pluggy_promover_para_conciliacao(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  SELECT payload INTO v_accounts_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'accounts'
  ORDER BY recebido_em DESC LIMIT 1;

  SELECT payload INTO v_transactions_raw
  FROM wealth_pluggy_raw
  WHERE item_id = p_item_id AND tipo_payload = 'transactions'
  ORDER BY recebido_em DESC LIMIT 1;

  IF v_accounts_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem raw accounts ainda; aguarde sync');
  END IF;

  FOR v_account IN
    SELECT * FROM jsonb_array_elements(COALESCE(v_accounts_raw->'results', '[]'::jsonb))
    WHERE (value->>'type') = 'BANK'
  LOOP
    v_acc_id   := v_account->>'id';
    v_acc_nome := COALESCE(v_account->>'name', v_account->>'marketingName', 'Conta bancaria');
    v_subtype  := v_account->>'subtype';
    v_banco    := COALESCE(v_account->'bankData'->>'transferNumber', v_account->>'number', '');
    v_qtd_contas := v_qtd_contas + 1;

    -- CANONICA: erp_banco_contas
    SELECT id INTO v_conta_id
    FROM erp_banco_contas
    WHERE company_id = v_item.company_id AND pluggy_account_id = v_acc_id;

    IF v_conta_id IS NULL THEN
      INSERT INTO erp_banco_contas (
        company_id, nome, banco, conta, tipo_conta,
        saldo_inicial, saldo_atual, ativo,
        incluir_no_fluxo, soma_no_saldo, incluir_no_resumo,
        pluggy_item_id, pluggy_account_id
      ) VALUES (
        v_item.company_id,
        v_acc_nome,
        COALESCE(v_account->>'marketingName', ''),
        v_banco,
        LOWER(COALESCE(v_subtype, 'corrente')),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        COALESCE(NULLIF(v_account->>'balance','')::numeric, 0),
        true, true, true, true,
        v_item.pluggy_item_id,
        v_acc_id
      ) RETURNING id INTO v_conta_id;
    ELSE
      UPDATE erp_banco_contas SET
        saldo_atual = COALESCE(NULLIF(v_account->>'balance','')::numeric, saldo_atual),
        updated_at  = now()
      WHERE id = v_conta_id;
    END IF;

    -- lote aberto por conta
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

    IF v_transactions_raw IS NOT NULL THEN
      FOR v_tx IN
        SELECT * FROM jsonb_array_elements(COALESCE(v_transactions_raw->'results', '[]'::jsonb))
        WHERE (value->>'accountId') = v_acc_id
      LOOP
        v_id_ext   := 'pluggy:' || (v_tx->>'id');
        v_valor    := COALESCE(NULLIF(v_tx->>'amount','')::numeric, 0);
        v_natureza := CASE WHEN v_valor >= 0 THEN 'credito' ELSE 'debito' END;
        v_valor    := ABS(v_valor);
        v_data     := COALESCE((v_tx->>'date')::date, CURRENT_DATE);

        BEGIN
          INSERT INTO conciliacao_movimento (
            lote_id, company_id,
            data_transacao, valor, natureza, descricao, id_externo, status
          ) VALUES (
            v_lote_id, v_item.company_id,
            v_data, v_valor, v_natureza,
            COALESCE(v_tx->>'description', v_tx->>'descriptionRaw', '—'),
            v_id_ext, 'pendente'
          );
          v_qtd_inseridas := v_qtd_inseridas + 1;
        EXCEPTION WHEN unique_violation THEN
          v_qtd_ja_existiam := v_qtd_ja_existiam + 1;
        END;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE wealth_pluggy_items
  SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('last_conciliacao_em', now())
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'qtd_contas_bank', v_qtd_contas,
    'qtd_movimentos_inseridos', v_qtd_inseridas,
    'qtd_movimentos_ja_existiam', v_qtd_ja_existiam,
    'tabela_alvo', 'erp_banco_contas'
  );
END;
$function$;
