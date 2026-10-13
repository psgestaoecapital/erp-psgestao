-- BUG #1 dashboard residual (CEO 26/05/2026 batch · cristalização 255d8f9b)
-- Card "Contas Financeiras" lateral mostrava R$ 0,00 porque erp_banco_contas.saldo_atual = NULL/0.
-- Reescrito pra calcular saldo por conta dinamicamente (saldo_inicial + movimentos pagos).
-- Shape JSON idêntico (ColunaContas.tsx consome contas[].saldo_atual sem mudança).
-- Validado: PS LTDA Sicoob 25084.93, PS Consultoria Nubank 2954.27.
-- Aplicado via MCP apply_migration · este arquivo é rastreio histórico.

CREATE OR REPLACE FUNCTION public.fn_ge_contas_resumo(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_saldo_total numeric;
  v_contas jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'saldo_atual')::numeric DESC), '[]'::jsonb) INTO v_contas
  FROM (
    SELECT jsonb_build_object(
      'id', bc.id,
      'nome', bc.nome,
      'tipo_conta', bc.tipo_conta,
      'saldo_atual',
        COALESCE(bc.saldo_inicial, 0)
        + COALESCE((
            SELECT SUM(COALESCE(er.valor_pago, er.valor, 0))
            FROM erp_receber er
            WHERE er.company_id = bc.company_id
              AND er.conta_bancaria = bc.nome
              AND er.data_pagamento IS NOT NULL
              AND er.status IN ('recebido','pago')
          ), 0)
        - COALESCE((
            SELECT SUM(COALESCE(ep.valor_pago, ep.valor, 0))
            FROM erp_pagar ep
            WHERE ep.company_id = bc.company_id
              AND ep.conta_bancaria = bc.nome
              AND ep.data_pagamento IS NOT NULL
              AND ep.status = 'pago'
          ), 0),
      'ultima_importacao', bc.updated_at,
      'conciliacoes_pendentes', COALESCE((
        SELECT COUNT(*) FROM conciliacao_lote cl
        WHERE cl.conta_bancaria_id = bc.id AND cl.status = 'pendente'
      ), 0)
    ) AS c
    FROM erp_banco_contas bc
    WHERE bc.company_id = p_company_id
      AND bc.ativo = true
      AND COALESCE(bc.soma_no_saldo, true) = true
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_total', v_saldo_total,
    'qtd_contas', jsonb_array_length(v_contas),
    'contas', v_contas
  );
END;
$$;
