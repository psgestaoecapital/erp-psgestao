-- FIX (RD-34 V5): 4 RPCs financeiras escreviam SO em erp_lancamentos (vazia).
-- Repontar pra erp_pagar / erp_receber (fonte unica de verdade pos #411).
--
-- Pre-req auditado:
--   - UNIQUE (company_id, ref_externa_sistema, ref_externa_id) em erp_pagar
--   - parcela e conta_bancaria sao VARCHAR (cast necessario)
--   - em_renegociacao existe em erp_receber
--   - erp_banco_contas.saldo_atual existe (numeric)
--   - erp_compras tem todas colunas referenciadas
--
-- batch_* atualizam AS DUAS tabelas (id existe em apenas uma) · sem race.

-- ===================================================================
-- 1) gerar_titulos_compra · cria parcelas em erp_pagar idempotente
-- ===================================================================
CREATE OR REPLACE FUNCTION public.gerar_titulos_compra(
  p_compra_id uuid,
  p_user_id   uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_compra        RECORD;
  v_parcelas      INT;
  v_valor_parcela DECIMAL;
  v_primeiro_venc DATE;
  v_valor_final   DECIMAL;
  v_total_gerado  INT := 0;
  i               INT;
BEGIN
  SELECT * INTO v_compra FROM erp_compras WHERE id = p_compra_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra nao encontrada';
  END IF;
  IF v_compra.titulos_gerados THEN
    RAISE EXCEPTION 'Titulos ja foram gerados';
  END IF;

  v_parcelas      := GREATEST(COALESCE(v_compra.parcelas, 1), 1);
  v_valor_parcela := ROUND(v_compra.total / v_parcelas, 2);
  v_primeiro_venc := COALESCE(v_compra.primeiro_vencimento, CURRENT_DATE + 30);

  FOR i IN 0..(v_parcelas - 1) LOOP
    v_valor_final := CASE
      WHEN i = v_parcelas - 1
        THEN v_compra.total - (v_valor_parcela * (v_parcelas - 1))
      ELSE v_valor_parcela
    END;

    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, descricao, categoria,
      valor, data_emissao, data_vencimento, status, parcela,
      numero_documento, observacoes, ref_externa_sistema, ref_externa_id
    ) VALUES (
      v_compra.company_id, v_compra.fornecedor_id, v_compra.fornecedor_nome,
      'Compra ' || v_compra.numero || ' - ' || v_compra.fornecedor_nome ||
        CASE WHEN v_parcelas > 1 THEN ' (' || (i + 1) || '/' || v_parcelas || ')' ELSE '' END,
      'Compras',
      v_valor_final,
      CURRENT_DATE,
      (v_primeiro_venc + (i * INTERVAL '1 month'))::date,
      'aberto',
      (i + 1)::text,                              -- parcela e VARCHAR
      v_compra.numero,
      'Gerado automaticamente do pedido de compra ' || v_compra.numero,
      'compra',
      'compra:' || v_compra.id::text || ':' || (i + 1)::text
    )
    ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) DO NOTHING;

    IF FOUND THEN
      v_total_gerado := v_total_gerado + 1;
    END IF;
  END LOOP;

  -- so marca titulos_gerados se a operacao criou ao menos 1 (defensivo
  -- pra reimport idempotente: 2a chamada nao reinsere e nao re-marca)
  IF v_total_gerado > 0 THEN
    UPDATE erp_compras
       SET titulos_gerados = true,
           data_faturamento = CURRENT_DATE
     WHERE id = p_compra_id;
  END IF;

  RETURN v_total_gerado;
END;
$fn$;

-- ===================================================================
-- 2) batch_baixa_titulos · pagar(-) OU receber(+) com saldo
-- ===================================================================
CREATE OR REPLACE FUNCTION public.batch_baixa_titulos(
  p_lancamento_ids   uuid[],
  p_data_pagamento   date,
  p_banco_conta_id   uuid DEFAULT NULL,
  p_forma_pagamento  varchar DEFAULT NULL,
  p_usuario_id       uuid DEFAULT NULL
)
RETURNS TABLE(total_processados integer, total_sucesso integer, total_erros integer, mensagem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_proc  INT := 0;
  v_ok    INT := 0;
  v_err   INT := 0;
  v_id    UUID;
  v_valor DECIMAL;
  v_found BOOL;
BEGIN
  FOREACH v_id IN ARRAY p_lancamento_ids LOOP
    v_proc := v_proc + 1;
    v_found := false;
    BEGIN
      -- Tenta como conta a pagar (saida)
      UPDATE erp_pagar
         SET status          = 'pago',
             data_pagamento  = p_data_pagamento,
             valor_pago      = valor,
             forma_pagamento = COALESCE(p_forma_pagamento, forma_pagamento),
             conta_bancaria  = COALESCE(p_banco_conta_id::text, conta_bancaria),
             updated_at      = NOW()
       WHERE id = v_id AND status <> 'cancelado'
       RETURNING valor INTO v_valor;
      IF FOUND THEN
        v_found := true;
        IF p_banco_conta_id IS NOT NULL THEN
          UPDATE erp_banco_contas
             SET saldo_atual = saldo_atual - v_valor
           WHERE id = p_banco_conta_id;
        END IF;
      ELSE
        -- Senao, tenta como conta a receber (entrada)
        UPDATE erp_receber
           SET status          = 'pago',
               data_pagamento  = p_data_pagamento,
               valor_pago      = valor,
               forma_pagamento = COALESCE(p_forma_pagamento, forma_pagamento),
               conta_bancaria  = COALESCE(p_banco_conta_id::text, conta_bancaria),
               updated_at      = NOW()
         WHERE id = v_id AND status <> 'cancelado'
         RETURNING valor INTO v_valor;
        IF FOUND THEN
          v_found := true;
          IF p_banco_conta_id IS NOT NULL THEN
            UPDATE erp_banco_contas
               SET saldo_atual = saldo_atual + v_valor
             WHERE id = p_banco_conta_id;
          END IF;
        END IF;
      END IF;
      IF v_found THEN v_ok := v_ok + 1; ELSE v_err := v_err + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT
    v_proc, v_ok, v_err,
    format('%s titulos processados: %s sucesso, %s erros', v_proc, v_ok, v_err)::TEXT;
END;
$fn$;

-- ===================================================================
-- 3) batch_cancelar_titulos · cancela nas duas tabelas
-- ===================================================================
CREATE OR REPLACE FUNCTION public.batch_cancelar_titulos(
  p_lancamento_ids uuid[],
  p_motivo         text DEFAULT 'Cancelamento em lote',
  p_usuario_id     uuid DEFAULT NULL
)
RETURNS TABLE(total_processados integer, total_sucesso integer, mensagem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n1  INT := 0;
  v_n2  INT := 0;
  v_obs TEXT := E'\n[CANCELADO] ' || p_motivo || ' em ' || TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI');
BEGIN
  UPDATE erp_pagar
     SET status      = 'cancelado',
         observacoes = COALESCE(observacoes, '') || v_obs,
         updated_at  = NOW()
   WHERE id = ANY(p_lancamento_ids) AND status <> 'cancelado';
  GET DIAGNOSTICS v_n1 = ROW_COUNT;

  UPDATE erp_receber
     SET status      = 'cancelado',
         observacoes = COALESCE(observacoes, '') || v_obs,
         updated_at  = NOW()
   WHERE id = ANY(p_lancamento_ids) AND status <> 'cancelado';
  GET DIAGNOSTICS v_n2 = ROW_COUNT;

  RETURN QUERY SELECT
    array_length(p_lancamento_ids, 1),
    (v_n1 + v_n2),
    format('%s titulos cancelados', v_n1 + v_n2)::TEXT;
END;
$fn$;

-- ===================================================================
-- 4) batch_alterar_vencimento · renegocia nas duas tabelas
-- ===================================================================
CREATE OR REPLACE FUNCTION public.batch_alterar_vencimento(
  p_lancamento_ids   uuid[],
  p_dias_adicionar   integer,
  p_usuario_id       uuid DEFAULT NULL
)
RETURNS TABLE(total_sucesso integer, mensagem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n1  INT := 0;
  v_n2  INT := 0;
  v_obs TEXT := E'\n[RENEGOCIADO] Vencimento alterado em ' || p_dias_adicionar ||
                ' dias em ' || TO_CHAR(NOW(), 'DD/MM/YYYY');
BEGIN
  UPDATE erp_pagar
     SET data_vencimento = (data_vencimento + (p_dias_adicionar || ' days')::INTERVAL)::date,
         observacoes     = COALESCE(observacoes, '') || v_obs,
         updated_at      = NOW()
   WHERE id = ANY(p_lancamento_ids) AND status IN ('aberto', 'vencido');
  GET DIAGNOSTICS v_n1 = ROW_COUNT;

  UPDATE erp_receber
     SET data_vencimento  = (data_vencimento + (p_dias_adicionar || ' days')::INTERVAL)::date,
         observacoes      = COALESCE(observacoes, '') || v_obs,
         em_renegociacao  = true,
         updated_at       = NOW()
   WHERE id = ANY(p_lancamento_ids) AND status IN ('aberto', 'vencido');
  GET DIAGNOSTICS v_n2 = ROW_COUNT;

  RETURN QUERY SELECT
    (v_n1 + v_n2),
    format('Vencimento alterado em %s titulos (+%s dias)', (v_n1 + v_n2), p_dias_adicionar)::TEXT;
END;
$fn$;

-- ===================================================================
-- Grants
-- ===================================================================
GRANT EXECUTE ON FUNCTION public.gerar_titulos_compra(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.batch_baixa_titulos(uuid[], date, uuid, varchar, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.batch_cancelar_titulos(uuid[], text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.batch_alterar_vencimento(uuid[], integer, uuid) TO authenticated, service_role;
